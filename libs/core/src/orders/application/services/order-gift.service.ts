/**
 * Order Gift Service (#3938, gifts spec 4.5)
 *
 * Evaluates OpenLinker promotions INLINE at ingestion, after the operator overlay
 * is applied and before anything reserves, routes or decrements: the gift has to
 * be a line of the order when stock is reserved, which the dispatch seam (it runs
 * after) cannot give. The decision is the promotions planner; the one write here
 * is a set of keyed lines into the overlay's `addedLines`.
 *
 * ## Where the decision lives
 * Which promotions apply, and why not, is the `promotions` context's planner; this
 * service is the order-side half: it projects the order onto facts, supplies the
 * gift's stock, and writes the keyed lines into the overlay's `addedLines`. The
 * promotion id is the line's `ruleRef`, so lines written before the move keep
 * working (the migration kept every id).
 *
 * ## Idempotency has two keys and they are checked in this order
 * 1. The overlay key `ol-gift:{ruleId}:{lineId}` already on the order -> the gift
 *    is there; nothing is written and nothing is counted again.
 * 2. The grant ledger's `(ruleId, orderId)` row -> the gift was GIVEN but the line
 *    write did not land (a crash between the two); the line is re-added without
 *    counting the grant a second time.
 * The grant is written BEFORE the line, so a crash leaves "granted, line missing",
 * which self-heals, and never "line present, ungranted", which would let the unit
 * cap under-count.
 *
 * ## Why it is fail-open
 * A gift is an extra. An error reading rules or stock must not cost the buyer's
 * order its ingestion, so every failure is logged and the order continues without
 * the gift; the next re-ingestion retries. An unknown stock number is never read
 * as zero or as plenty - the rule reports `gift-stock-unknown` and adds nothing.
 *
 * ## When a gift may be added
 * New grants (and the "granted, line missing" self-heal) run only while the order
 * is pre-routing and pre-mirror (`allowNewGrants`): once work, a parcel or a
 * destination order exists, a gift line written now would never be picked,
 * decremented or mirrored, and its hold would leak. A rule refused at first
 * ingestion (paused, capped) therefore does not apply on a later re-poll.
 *
 * ## Known limits
 * - Two ingestions of different orders are serialised per rule by an advisory
 *   lock, and units already granted but not yet reserved are subtracted from the
 *   gift's stock (`getPendingGrantUnits`), so the last unit is not given twice.
 *   Two different RULES giving the same variant are not serialised against each
 *   other beyond that pending-units subtraction.
 * - The frozen line expansion (#3607) is taken after this runs, so a gift that is
 *   itself a bundle expands on a first ingestion; a window that is closed adds
 *   nothing, so no gift ever meets a frozen expansion that predates it.
 *
 * @module libs/core/src/orders/application/services
 * @implements {IOrderGiftService}
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  PROMOTION_APPLICATION_SERVICE_TOKEN,
  type IPromotionApplicationService,
  type Promotion,
  type PromotionLineGrant,
  type PromotionOrderFacts,
  type PromotionPlanLine,
  type PromotionStockAnswer,
  type PromotionStockReader,
} from '@openlinker/core/promotions';
import { AVAILABILITY_SERVICE_TOKEN, type IAvailabilityService } from '@openlinker/core/inventory';
import {
  BUNDLE_DEFINITION_SERVICE_TOKEN,
  PRODUCTS_SERVICE_TOKEN,
  taxRateState,
  type BundleDefinition,
  type IBundleDefinitionService,
  type IProductsService,
} from '@openlinker/core/products';
import { Logger } from '@openlinker/shared/logging';

import { ORDER_RECORD_SERVICE_TOKEN } from '../../orders.tokens';
import { isGiftDocumentForm, type LineGift } from '../../domain/types/incoming-order.types';
import {
  applyOrderEditsToOrder,
  OL_GIFT_LINE_KEY_PREFIX,
  olGiftLineKey,
  type OrderAddedLineEdit,
} from '../../domain/types/order-edits.types';
import type { Order } from '../../domain/types/order.types';
import { buildOrderPromotionFacts } from '../../domain/order-promotion-facts-projection';
import { IOrderRecordService } from '../interfaces/order-record.service.interface';
import { freezeGiftUnitCost } from './gift-unit-cost';
import { previewPhysicalLines } from './order-line-expansion';
import type {
  ApplyGiftRulesInput,
  ApplyGiftRulesResult,
  GiftPreviewInput,
  GiftPreviewResult,
  IOrderGiftService,
} from './order-gift.service.interface';

/** What a gift line is built from: the promotion's benefit at grant time, or the stored grant on a self-heal. */
interface GiftLineSource {
  readonly productId: string;
  readonly variantId: string;
  readonly documentForm: string | null;
  readonly documentUnitPrice?: string | null;
}

/** The promotion id inside an overlay key `ol-gift:{promotionId}:{lineId}`, or `null` for any other key. */
function promotionIdOfGiftKey(key: string): string | null {
  if (!key.startsWith(OL_GIFT_LINE_KEY_PREFIX)) return null;
  const rest = key.slice(OL_GIFT_LINE_KEY_PREFIX.length);
  const id = rest.slice(0, rest.indexOf(':'));
  return id.length > 0 ? id : null;
}

/** One gift line per promotion per order today, so its `lineId` is a fixed ordinal. */
const GIFT_LINE_ID = '1';

@Injectable()
export class OrderGiftService implements IOrderGiftService {
  private readonly logger = new Logger(OrderGiftService.name);

  constructor(
    @Inject(PROMOTION_APPLICATION_SERVICE_TOKEN)
    private readonly promotions: IPromotionApplicationService,
    @Inject(AVAILABILITY_SERVICE_TOKEN)
    private readonly availability: IAvailabilityService,
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecords: IOrderRecordService,
    @Inject(PRODUCTS_SERVICE_TOKEN)
    private readonly products: IProductsService,
    @Inject(BUNDLE_DEFINITION_SERVICE_TOKEN)
    private readonly bundles: IBundleDefinitionService
  ) {}

  async applyGiftRules(input: ApplyGiftRulesInput): Promise<ApplyGiftRulesResult> {
    const { order } = input;
    let inPlay: readonly Pick<Promotion, 'id' | 'name'>[] = [];
    try {
      // A cancelled order is never given a gift (its grant was released), and an
      // order past routing/mirroring cannot take a new line (see the header).
      if (order.status === 'cancelled' || input.cancelled === true || !input.allowNewGrants) {
        return { order, outcomes: [] };
      }

      const now = new Date();
      const existingKeys = new Set(Object.keys(input.edits?.addedLines ?? {}));
      const applied = await this.promotions.apply({
        facts: this.factsFromOrder(order, input.sourceConnectionId, input.occurredAt),
        lines: this.planLines(order),
        componentProductIds: await this.componentProductIds(
          order.items,
          input.frozenDefinitions ?? null
        ),
        customerId: input.customerId,
        presentPromotionIds: new Set(
          [...existingKeys].flatMap((key) => {
            const id = promotionIdOfGiftKey(key);
            return id === null ? [] : [id];
          })
        ),
        readStock: this.stockReader(),
        isFirstIngestion: input.isFirstIngestion,
      });
      inPlay = applied.promotions;

      const newLines: Record<string, OrderAddedLineEdit> = {};
      for (const grant of applied.lineGrants) {
        newLines[olGiftLineKey(grant.promotion.id, GIFT_LINE_ID)] = await this.buildAddedLine(
          grant,
          now,
          input.occurredAt
        );
      }

      let result = order;
      if (Object.keys(newLines).length > 0) {
        const written = await this.orderRecords.applyOrderEdit({
          internalOrderId: order.id,
          expectedRev: null,
          addedLines: newLines,
        });
        if (written !== null) {
          // Re-apply the overlay from the channel original: the gift is now part
          // of every later step (reservation, routing, the destination mirror).
          result = applyOrderEditsToOrder(input.channelOrder, written.orderEdits);
        } else {
          this.logger.warn(
            `Gift lines for order ${order.id} were not written (the record is not ready); the next ingestion retries.`
          );
        }
      }
      return { order: result, outcomes: applied.outcomes };
    } catch (error) {
      this.logger.error(
        `Promotions failed for order ${order.id}; the order continues without a gift: ${(error as Error).message}`,
        (error as Error).stack
      );
      // Fail-open must not be silent: an order from a journal-cursor source is not
      // re-delivered, so a retry may never come.
      await this.promotions.recordFailure(
        inPlay,
        order.id,
        `Gift not added to order ${order.id}: ${(error as Error).message}`
      );
      return { order, outcomes: [] };
    }
  }

  async releaseGrantsForCancelledOrder(internalOrderId: string): Promise<void> {
    try {
      const released = await this.promotions.releaseForOrder(internalOrderId);
      if (released > 0) {
        this.logger.log(
          `gift_grants_released order=${internalOrderId} count=${released}: the cancelled order's gift units returned to the promotions`
        );
      }
    } catch (error) {
      this.logger.error(
        `Could not release the gift grants of cancelled order ${internalOrderId}: ${(error as Error).message}`,
        (error as Error).stack
      );
    }
  }

  async previewForOrder(input: GiftPreviewInput): Promise<GiftPreviewResult> {
    const { record, draft } = input;
    const items = record.orderItems;
    return this.promotions.preview({
      facts: buildOrderPromotionFacts(record, record.placedAt ?? record.createdAt),
      lines: items.map<PromotionPlanLine>((item) => ({
        productId: item.productId,
        ...(item.variantId !== undefined && { variantId: item.variantId }),
        quantity: item.quantity,
        isGift: item.gift !== undefined,
      })),
      componentProductIds: await this.componentProductIds(
        items,
        record.lineExpansion?.definitions ?? null
      ),
      customerId: input.customerId !== undefined ? input.customerId : record.customerId,
      readStock: this.stockReader(),
      ...(draft !== undefined && { draft }),
    });
  }

  private factsFromOrder(
    order: Order,
    sourceConnectionId: string,
    occurredAt: Date
  ): PromotionOrderFacts {
    const country = order.shippingAddress?.country;
    return {
      orderId: order.id,
      occurredAt,
      sourceConnectionId,
      ...(country !== undefined && country !== '' && { country }),
      totalGross: order.totals.total,
      currency: order.totals.currency,
      lineProductIds: order.items.filter((i) => i.gift === undefined).map((i) => i.productId),
      lineVariantIds: order.items.flatMap((i) =>
        i.gift === undefined && i.variantId !== undefined ? [i.variantId] : []
      ),
    };
  }

  /**
   * Product ids of the physical components of the order's bundle lines (#3945),
   * from the same expansion the line freeze uses: the frozen definitions when the
   * record has them, the live ones otherwise. Gift lines are left out (a gift is
   * not the buyer's own product), but a gift SLOT inside a set is a component and
   * counts, so a buyer of a set that already contains the gift gets no second one.
   * Used by ingestion and the dry run alike, so they cannot disagree.
   */
  private async componentProductIds(
    items: Order['items'],
    frozenDefinitions: readonly BundleDefinition[] | null
  ): Promise<ReadonlySet<string>> {
    const own = items.filter((item) => item.gift === undefined);
    const physical = await previewPhysicalLines(own, frozenDefinitions, this.bundles);
    return new Set(
      physical.filter((line) => line.parentLineId !== undefined).map((line) => line.productId)
    );
  }

  private planLines(order: Order): PromotionPlanLine[] {
    return order.items.map((item) => ({
      productId: item.productId,
      ...(item.variantId !== undefined && { variantId: item.variantId }),
      quantity: item.quantity,
      isGift: item.gift !== undefined,
    }));
  }

  /**
   * The gift's promisable quantity per variant, or `unknown` (never zero) when the
   * availability read cannot answer. Units another order was granted but has not
   * reserved are subtracted by the promotions context, which owns the ledger.
   */
  private stockReader(): PromotionStockReader {
    return async (variantIds) => {
      const answers = new Map<string, PromotionStockAnswer>();
      const quantities = await this.availability.getPromisableQuantities({
        variantIds: [...variantIds],
        scope: { kind: 'global' },
      });
      for (const q of quantities) {
        answers.set(
          q.productVariantId,
          q.provenance === 'unknown' || q.quantity === null
            ? { kind: 'unknown' }
            : { kind: 'known', available: q.quantity }
        );
      }
      return answers;
    };
  }

  private async buildAddedLine(
    grant: PromotionLineGrant,
    at: Date,
    placedAt: Date
  ): Promise<OrderAddedLineEdit> {
    const action: GiftLineSource = {
      productId: grant.productId,
      variantId: grant.variantId,
      documentForm: grant.documentForm,
      documentUnitPrice: grant.documentUnitPrice ?? null,
    };
    const gift: LineGift = {
      source: 'ol-rule',
      ruleRef: grant.promotion.id,
      ...(isGiftDocumentForm(action.documentForm) && { documentForm: action.documentForm }),
      ...(action.documentForm === 'custom-price' &&
        action.documentUnitPrice != null && { documentUnitPrice: action.documentUnitPrice }),
    };
    return {
      changeId: grant.promotion.id,
      editedAt: at.toISOString(),
      editedBy: null,
      productId: action.productId,
      variantId: action.variantId,
      quantity: grant.quantity,
      ...(await this.catalogueIdentity(action, grant.promotion.name)),
      gift,
      ...(await this.catalogueTaxRate(action)),
      ...(await freezeGiftUnitCost(this.products, action.variantId, placedAt, this.logger)),
    };
  }

  /**
   * What the line is CALLED and its SKU: the gift product's own, from the
   * catalogue at grant time. The promotion's name is the fallback for the name
   * only when the catalogue answers nothing (it stays recoverable through
   * `gift.ruleRef`); an internal id is never written as a SKU.
   */
  private async catalogueIdentity(
    action: GiftLineSource,
    promotionName: string
  ): Promise<Pick<OrderAddedLineEdit, 'name' | 'sku'>> {
    let name: string | undefined;
    let sku: string | undefined;
    try {
      const [variant] = await this.products.getVariantsByIds([action.variantId]);
      if (variant?.sku) sku = variant.sku;
      const product = await this.products.getProduct(action.productId);
      if (product?.name) name = product.name;
    } catch (error) {
      this.logger.warn(
        `Identity for gift product ${action.productId} could not be read: ${(error as Error).message}`
      );
    }
    return { name: name ?? promotionName, ...(sku !== undefined && { sku }) };
  }

  /**
   * The shop catalogue's rate for the gift (#3939), stamped on the overlay entry so
   * the destination mirror and the documents read the same rate. Best-effort: a
   * catalogue that answers nothing leaves the line rate-less, never guessed.
   */
  private async catalogueTaxRate(
    action: GiftLineSource
  ): Promise<Pick<OrderAddedLineEdit, 'taxRate' | 'taxRateCountry' | 'taxSource' | 'taxRateReadAt'>> {
    try {
      const rate = await this.products.getEffectiveTaxRate(action.productId, action.variantId);
      if (rate && taxRateState(rate) === 'known' && rate.code) {
        return {
          taxRate: rate.code,
          ...(rate.countryIso2 ? { taxRateCountry: rate.countryIso2 } : {}),
          taxSource: 'shop',
          ...(rate.readAt ? { taxRateReadAt: rate.readAt.toISOString() } : {}),
        };
      }
    } catch (error) {
      this.logger.warn(
        `Tax rate for gift product ${action.productId} could not be read: ${(error as Error).message}`
      );
    }
    return {};
  }
}
