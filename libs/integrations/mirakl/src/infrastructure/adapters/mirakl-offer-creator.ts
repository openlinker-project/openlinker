/**
 * Mirakl Offer Creator
 *
 * `OfferCreator` for a Mirakl operator (#4278). On Mirakl an offer must point
 * to a catalogue card, found by EAN (P31):
 *
 * - **The card exists:** the offer is created with OF24 carrying the full
 *   field set a create needs, because OF24 resets every field it does not
 *   receive: `shop_sku` (from the OL variant id), `product_id` (the EAN) and
 *   `product_id_type: EAN`, `state_code` 11 (new), price and quantity, lead
 *   time and logistic class (the batch's `platformParams`, else the
 *   connection's `offerDefaults`), and the `gpsr-*` offer fields. OF24 is an
 *   asynchronous import: the create answers `validating` and records the
 *   import (`mirakl_offer_writes`, kind `offer`) so the creation poller can
 *   follow it.
 * - **No card (part 2):** the card is built from the command (category,
 *   title, description, EAN, images, VAT, variant group, set attributes, and
 *   the offer's parameters; see `mirakl-card.policy.ts`) and queued as a
 *   `card` write together with the OF24 line. The card pass sends queued cards
 *   as one P41 file at most every 15 minutes, follows the operator's review,
 *   and sends the OF24 line once the card is in the catalogue. The create
 *   answers `draft` with a "waiting for the card" note: the operator reviews
 *   cards by hand, which can take longer than the creation poller waits, and a
 *   draft never ends as a timed-out failure. A card refused before it is sent
 *   (a required attribute missing, a value not on the list) refuses the offer
 *   here, naming the attribute.
 *
 * Only a definite answer refuses the offer: no EAN, a card that cannot be
 * built, or a 4xx (other than 429) on OF24. A failed P31 or PM11 read, a 429 or
 * a 5xx is thrown on, so the job retries; a repeated OF24 is safe, because
 * `update_delete: update` upserts by `shop_sku`, and a repeated card request
 * replaces the queued one instead of adding a second card.
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters
 */
import {
  OfferCreateRejectedException,
  type CreateOfferCommand,
  type CreateOfferResult,
  type CreateOfferValidationError,
} from '@openlinker/core/listings';
import { Logger } from '@openlinker/shared/logging';
import { MiraklApiException } from '../../domain/exceptions/mirakl-api.exception';
import { buildMiraklCardRow } from '../../domain/policies/mirakl-card.policy';
import { readMiraklOfferDefaults } from '../../domain/policies/mirakl-connection-config.policy';
import { buildMiraklGpsrFields } from '../../domain/policies/mirakl-gpsr.policy';
import {
  formatMiraklPrice,
  formatMiraklQuantity,
} from '../../domain/policies/mirakl-offer-file.policy';
import { deriveMiraklShopSku } from '../../domain/policies/mirakl-shop-sku.policy';
import type { MiraklOfferWriteRepositoryPort } from '../../domain/ports/mirakl-offer-write-repository.port';
import type { MiraklCardRequest, MiraklOfferLine } from '../../domain/types/mirakl-card.types';
import type { MiraklOfferDefaults } from '../../domain/types/mirakl-connection.types';
import type { MiraklCardAttributeCodes } from '../../domain/types/mirakl-operator-profile.types';
import type { IMiraklHttpClient } from '../http/mirakl-http-client.interface';
import type { MiraklCatalog } from './mirakl-catalog';
import { describeMiraklFailure } from './mirakl-order-reader';

const OF24_PATH = '/api/offers';
/** Mirakl's offer state for a new item. */
const STATE_NEW = '11';

export interface MiraklOfferCreatorDeps {
  readonly connectionId: string;
  readonly adapterKey: string;
  readonly brand: string;
  readonly httpClient: IMiraklHttpClient;
  readonly catalog: MiraklCatalog;
  readonly writes: () => MiraklOfferWriteRepositoryPort;
  readonly offerDefaults: MiraklOfferDefaults;
  readonly cardAttributes: MiraklCardAttributeCodes;
}

/** Code of the note a create carries while its card waits for the operator. */
export const MIRAKL_CARD_PENDING_CODE = 'MIRAKL_CARD_PENDING';

/**
 * A refusal Mirakl answered about the request itself; anything else may pass.
 * A 401 / 403 never gets here: the client throws `MiraklAuthenticationException`
 * for those, which passes through so the connection is flagged for re-auth.
 */
function isDefiniteRefusal(error: MiraklApiException): boolean {
  const status = error.statusCode;
  return status !== undefined && status >= 400 && status < 500 && status !== 429;
}

export class MiraklOfferCreator {
  private readonly logger = new Logger(MiraklOfferCreator.name);

  constructor(private readonly deps: MiraklOfferCreatorDeps) {}

  async createOffer(cmd: CreateOfferCommand): Promise<CreateOfferResult> {
    const ean = (cmd.overrides?.ean ?? cmd.variantBarcode ?? '').trim();
    const shopSku = deriveMiraklShopSku(cmd.internalVariantId);
    const settings = this.resolveSettings(cmd);
    const errors: CreateOfferValidationError[] = [...settings.errors];
    if (!ean) {
      errors.push({
        field: 'variantBarcode',
        code: 'EAN_REQUIRED',
        message: `${this.deps.brand} offers point to a catalogue card found by EAN; this variant has none.`,
      });
    }
    const price = formatMiraklPrice(String(cmd.price.amount));
    if (price === null) {
      errors.push({ field: 'price', code: 'PRICE_INVALID', message: 'The price is not a number.' });
    }
    if (errors.length > 0) {
      throw new OfferCreateRejectedException(this.deps.adapterKey, 0, errors);
    }

    const offer = this.buildOfferLine(cmd, shopSku, ean, price as string, settings);
    const cards = (await this.deps.catalog.readCards([ean])).get(ean) ?? [];
    if (cards.length === 0) {
      return this.queueCard(cmd, shopSku, ean, offer);
    }

    if (cards.length > 1) {
      this.logger.warn(
        `${this.deps.brand} has ${cards.length} catalogue cards for EAN ${ean}; the offer is sent ` +
          `by EAN and ${this.deps.brand} picks the card (connection: ${this.deps.connectionId})`
      );
    }

    const body = { offers: [offer] };
    let importId: string;
    try {
      const { data } = await this.deps.httpClient.post<{ import_id?: string | number }>(
        OF24_PATH,
        body
      );
      if (data?.import_id === undefined || data.import_id === null || data.import_id === '') {
        throw new MiraklApiException(
          `${this.deps.brand} answered the offer import without an import_id`
        );
      }
      importId = String(data.import_id);
    } catch (error) {
      if (error instanceof MiraklApiException && isDefiniteRefusal(error)) {
        throw new OfferCreateRejectedException(this.deps.adapterKey, error.statusCode ?? 0, [
          {
            code: error.miraklCode ?? 'MIRAKL_OFFER_IMPORT_REFUSED',
            message: `${this.deps.brand} refused the offer: ${describeMiraklFailure(error.statusCode, error.miraklCode)}`,
          },
        ]);
      }
      throw error;
    }

    await this.deps
      .writes()
      .recordSubmitted(
        this.deps.connectionId,
        'offer',
        [{ offerSku: shopSku, value: price as string }],
        importId
      );
    return { externalOfferId: shopSku, status: 'validating' };
  }

  /** The OF24 line, sent now on an existing card or later on a created one. */
  private buildOfferLine(
    cmd: CreateOfferCommand,
    shopSku: string,
    ean: string,
    price: string,
    settings: { leadTimeToShip?: number; logisticClass?: string }
  ): MiraklOfferLine {
    return {
      shop_sku: shopSku,
      product_id: ean,
      product_id_type: 'EAN',
      price,
      quantity: Number(formatMiraklQuantity(cmd.stock)),
      state_code: STATE_NEW,
      update_delete: 'update',
      leadtime_to_ship: settings.leadTimeToShip,
      logistic_class: settings.logisticClass,
      offer_additional_fields: buildMiraklGpsrFields(cmd.gpsr),
    };
  }

  /**
   * No card for the EAN: build one from the command and queue it with the
   * offer line. A card already sent for this offer is not sent again.
   */
  private async queueCard(
    cmd: CreateOfferCommand,
    shopSku: string,
    ean: string,
    offer: MiraklOfferLine
  ): Promise<CreateOfferResult> {
    const pending: CreateOfferResult = {
      externalOfferId: shopSku,
      status: 'draft',
      validationErrors: [
        {
          code: MIRAKL_CARD_PENDING_CODE,
          message:
            `${this.deps.brand} has no product card for EAN ${ean} yet. OpenLinker sends the card ` +
            `to ${this.deps.brand} and creates the offer once ${this.deps.brand} accepts the card.`,
          summary: `Waiting for ${this.deps.brand} to accept the product card`,
        },
      ],
    };
    const writes = this.deps.writes();
    const earlier = await writes.findLatest(this.deps.connectionId, 'card', shopSku);
    if (earlier?.status === 'submitted') {
      return pending;
    }

    const categoryId = cmd.overrides?.categoryId?.trim();
    if (!categoryId) {
      throw new OfferCreateRejectedException(this.deps.adapterKey, 0, [
        {
          field: 'overrides.categoryId',
          code: 'MIRAKL_CARD_CATEGORY_REQUIRED',
          message: `${this.deps.brand} has no product card for EAN ${ean}; choose a category to create one.`,
        },
      ]);
    }
    const attributes = await this.deps.catalog.readCardAttributes(categoryId);
    const built = buildMiraklCardRow({
      brand: this.deps.brand,
      codes: this.deps.cardAttributes,
      attributes,
      categoryId,
      catalogCode: shopSku,
      ean,
      title: cmd.overrides?.title,
      description: cmd.overrides?.description ?? undefined,
      imageUrls: cmd.overrides?.imageUrls ?? [],
      taxRate: cmd.taxRate,
      // The offer build already merged the operator's overrides into these.
      parameters: cmd.parameters ?? [],
      variantGroup: cmd.variantGroup,
      productSet: cmd.productSet,
    });
    if (built.errors.length > 0) {
      throw new OfferCreateRejectedException(this.deps.adapterKey, 0, built.errors);
    }
    const request: MiraklCardRequest = { ean, card: built.row, offer };
    await writes.recordPending(this.deps.connectionId, 'card', [
      { offerSku: shopSku, value: JSON.stringify(request) },
    ]);
    this.logger.log(
      `Queued a ${this.deps.brand} product card for EAN ${ean} (offer ${shopSku}) [connectionId=${this.deps.connectionId}]`
    );
    return pending;
  }

  private resolveSettings(cmd: CreateOfferCommand): {
    leadTimeToShip?: number;
    logisticClass?: string;
    errors: CreateOfferValidationError[];
  } {
    const batch = readMiraklOfferDefaults(cmd.overrides?.platformParams);
    const errors: CreateOfferValidationError[] = [];
    if (batch.kind === 'invalid') {
      errors.push({
        field: 'overrides.platformParams',
        code: 'OFFER_SETTINGS_INVALID',
        message: 'Lead time must be 0-30 days and the logistic class a code.',
      });
    }
    const fromBatch: MiraklOfferDefaults = batch.kind === 'valid' ? batch : {};
    const leadTimeToShip = fromBatch.leadTimeToShip ?? this.deps.offerDefaults.leadTimeToShip;
    const logisticClass = fromBatch.logisticClass ?? this.deps.offerDefaults.logisticClass;
    if (leadTimeToShip === undefined) {
      errors.push({
        field: 'overrides.platformParams.leadTimeToShip',
        code: 'LEAD_TIME_REQUIRED',
        message: `Set the lead time (days to ship) for ${this.deps.brand} offers.`,
      });
    }
    if (logisticClass === undefined) {
      errors.push({
        field: 'overrides.platformParams.logisticClass',
        code: 'LOGISTIC_CLASS_REQUIRED',
        message: `Set the logistic class for ${this.deps.brand} offers.`,
      });
    }
    return { leadTimeToShip, logisticClass, errors };
  }
}
