/**
 * Order -> RegisterTransactionCommand mapper (command composer)
 *
 * Pure function (no NestJS, no I/O) that composes a `RegisterTransactionCommand`
 * from a core `Order` plus caller-supplied context. The client never sends the
 * lines: an operator asks for an order to be registered, and the sale is derived
 * server-side from the order snapshot.
 *
 * Neutral throughout - no country, regime or vendor vocabulary, and NO tax
 * arithmetic: the amounts are the buyer-paid gross figures the source reported,
 * carried through unchanged (ADR-042 decision 8).
 *
 * @module libs/core/src/fiscalization/application/mappers
 */
// Value imports come from the `@openlinker/core/orders/types` cycle-breaker
// sub-barrel, never the main barrel: that one re-exports `OrdersModule`, whose
// own module file value-imports `@openlinker/core/fiscalization`, so a value
// import here closes a `fiscalization -> orders -> fiscalization` CJS load
// cycle and leaves `FISCAL_REGISTRATION_SERVICE_TOKEN` undefined at the
// `@Inject()` decorator in `SalesDocumentViewService`. `Order` / `OrderItem`
// are type-only and erase, so they may come from either.
import type { Order, OrderItem } from '@openlinker/core/orders';
import { decodeBuyerTaxIdColumn } from '@openlinker/core/orders/types';
import {
  describeNetPricedOrderRefusal,
  formatReceiptLineName,
  resolveDeliveryLine,
  shippingSplitInputs,
  spreadDeliveryAcrossLines,
  splitShippingAcrossRates,
  describeDiscountCause,
  quantityScaledReconciliationEpsilon,
  type ResolvedDeliveryLine,
  reconcileDiscountRounding,
  presentGiftLines,
  presentBundleComponents,
  type BundleDocumentPresentation,
  resolveGiftDocumentForm,
  resolveGiftPresentationFields,
  type GiftLineForm,
} from '@openlinker/core/sales-documents';
import { Logger } from '@openlinker/shared/logging';

import type {
  FiscalRecipient,
  FiscalTransactionLine,
  RegisterTransactionCommand,
} from '../../domain/types/fiscalization.types';
import { InvalidFiscalLineError } from './errors/invalid-fiscal-line.error';
import { UnsupportedFiscalPriceTreatmentError } from './errors/unsupported-fiscal-price-treatment.error';

const logger = new Logger('OrderToRegisterTransactionCommandMapper');

/** Inputs to {@link toRegisterTransactionCommand}. */
export interface OrderToRegisterTransactionCommandInput {
  order: Order;
  connectionId: string;
  /**
   * MANDATORY exactly-once key (ADR-042 decision 6). There is no keyless mode:
   * the caller must decide what "the same registration" means before core will
   * run one.
   */
  idempotencyKey: string;
  /**
   * Legacy single name for the shipping line (`config.invoicing.shippingLineName`).
   * Used only when no {@link deliveryLine} is supplied (ADR-082 decision 5).
   */
  shippingLineName?: string;
  /**
   * The delivery line resolved from the order-source connection's
   * `deliveryOnDocuments` (#3905, ADR-082). Absent resolves to the legacy name
   * (or `Shipping`) in `goods` mode - the pre-#3905 behaviour plus the rate
   * suffix a receipt name always carries.
   */
  deliveryLine?: ResolvedDeliveryLine;
  /**
   * The order's `order_records.taxRateEra` marker (#2260 review), passed
   * through onto the command so the write-path tax-rate guard can exempt
   * pre-rollout history. Mirrors the invoice mapper's own input field.
   */
  taxRateEra?: string | null;
  /**
   * The order's persisted `order_records.buyerTaxId` COLUMN (#3187, ADR-073
   * decision 1) - the RAW three-state value, read through
   * {@link decodeBuyerTaxIdColumn} inside this function rather than by the
   * caller.
   *
   * Deliberately the persisted column and NOT `order.billingAddress?.taxId` /
   * `order.shippingAddress?.taxId`, even though `readBuyerTaxId(order)` would
   * answer the same question from the live `Order`: the column is written
   * ONLY when `OL_STORE_PII` is on (`order-record.service.ts`), so reading the
   * live address instead would leak the number onto a receipt on an
   * installation that chose not to keep it - the exact configuration the
   * mockup's own gap note names ("the whole epic is inert on one
   * configuration"). Passing `undefined` (the caller has no record yet) is
   * indistinguishable from a column of `NULL` and both compose no field on the
   * command, which is correct either way: nothing to send.
   */
  buyerTaxId?: string | null;
  /**
   * The connection's gift-form override (`readGiftConnectionForm`); absent
   * inherits the OpenLinker-wide default. A gift's own form wins over both
   * (gifts spec section 8.3).
   */
  giftConnectionForm?: GiftLineForm;
  /** The amount that goes with a `custom-price` connection form. */
  giftConnectionUnitPrice?: string;
  /** The OpenLinker-wide default; absent is `technical-cent`. */
  giftGlobalForm?: GiftLineForm;
  /** The amount that goes with a `custom-price` OpenLinker-wide default. */
  giftGlobalUnitPrice?: string;
  /**
   * Ignored: a receipt is always composed as if the register refuses a
   * zero-value line (ADR-082 decision 7), whatever the provider declares.
   * Kept so existing callers still compile.
   */
  acceptsZeroValueLine?: boolean;
  /** Components of bundle lines, presented by the automatic rate rule (#3934). */
  bundleDocument?: BundleDocumentPresentation;
}

/**
 * Compose a `RegisterTransactionCommand` from an `Order`.
 *
 * Throws {@link UnsupportedFiscalPriceTreatmentError} when the order is
 * net-priced, and {@link InvalidFiscalLineError} when an item's quantity is not
 * a positive finite number, or when the composed lines do not sum to the
 * order's reported gross total. All of them fire BEFORE anything is persisted or
 * sent, so a malformed order produces no record and no provider call.
 *
 * Appends a gross shipping line when the buyer paid for shipping, and then
 * VERIFIES that the lines sum to the buyer-paid order total rather than merely
 * intending to - see {@link assertLinesSumToTotal}.
 */
export function toRegisterTransactionCommand(
  input: OrderToRegisterTransactionCommandInput,
): RegisterTransactionCommand {
  const { order, connectionId, idempotencyKey, shippingLineName, taxRateEra, buyerTaxId } = input;
  const deliveryLine =
    input.deliveryLine ?? resolveDeliveryLine(null, { legacyName: shippingLineName });

  // GROSS-only: a net-priced order would register net amounts labelled as gross,
  // and core may not convert (it never computes or defaults a tax rate). Fail
  // loud. An ABSENT treatment is the documented gross assumption - marketplaces
  // report buyer-paid gross - so it is accepted.
  //
  // This checks LINE-level `taxTreatment`, never `totals.totalTaxTreatment`
  // (#2829/#2832) — see `describeNetPricedOrderRefusal`'s doc comment
  // (#2835) for why the latter cannot relax this guard.
  const refusal = describeNetPricedOrderRefusal(order, 'fiscally registered');
  if (refusal !== null) {
    throw new UnsupportedFiscalPriceTreatmentError(refusal);
  }

  // Presented before delivery and discount reconciliation (#3930), so the
  // receipt total still equals what the buyer paid. The provider refusing a
  // zero line is the reason this runs here and not in an
  // adapter: the amount has to move between lines of the same rate.
  type WorkingLine = FiscalTransactionLine & {
    isGift?: boolean;
    giftForm?: GiftLineForm;
    giftUnitPriceGross?: number;
    itemId?: string;
    referenceUnitPriceGross?: number;
  };
  const itemLines = presentBundleComponents<WorkingLine>(
    order.items.map((item) => ({
      ...toFiscalLine(item, order.id),
      isGift: item.gift !== undefined,
      ...(item.gift !== undefined && resolveGiftPresentationFields(item.gift.documentForm, item.gift.documentUnitPrice, input)),
      // The receipt line carries no order line id; the item id is what the
      // bundle presentation keys on.
      itemId: item.id,
    })),
    (line) => line.itemId,
    input.bundleDocument,
    (parent, part) => ({
      ...parent,
      // A component keeps its own name at its own rate: the register binds one
      // name to one rate, so the set's name must never be repeated.
      name:
        part.component.name?.trim() ||
        part.component.sku?.trim() ||
        `${parent.name} / ${part.component.variantId}`,
      quantity: part.quantity,
      unitPriceGross: part.unitPriceGross,
      taxRate: part.taxRate,
      productId: part.component.productId,
      sku: part.component.sku ?? null,
      isGift: part.isGift,
      // A gift slot's own form is the most specific level (#3940).
      ...(part.isGift && part.component.giftDocumentForm !== undefined && {
        giftForm: part.component.giftDocumentForm,
      }),
      ...(part.referenceUnitPriceGross !== undefined && {
        referenceUnitPriceGross: part.referenceUnitPriceGross,
      }),
    }),
    { currency: order.totals.currency },
  );
  // A receipt always refuses zero (`false`, never the provider's declaration).
  const presentedGifts = presentGiftLines(
    itemLines.lines,
    resolveGiftDocumentForm(undefined, input.giftConnectionForm, input.giftGlobalForm, {
      connection: input.giftConnectionUnitPrice,
      global: input.giftGlobalUnitPrice,
    }).form,
    false,
    { currency: order.totals.currency },
  );
  for (const note of presentedGifts.notes) {
    logger.warn(`Order ${order.id}: gift presentation note ${note}`);
  }
  if (presentedGifts.internalRecordLines.length > 0) {
    logger.log(
      `Order ${order.id}: ${presentedGifts.internalRecordLines.length} gift line(s) kept off the receipt (internal record)`,
    );
  }
  // The gift marker stays through rounding reconciliation (a gap must never
  // land on a free item) and is stripped afterwards.
  const productLines: WorkingLine[] = presentedGifts.lines;

  const lines = applyDelivery(productLines, order, deliveryLine);

  // E-45: a discounted multi-unit line must not drift a minor unit from the total.
  const reconciledLines = reconcileDiscountRounding(lines, productLines.length, order.totals).map(
    (presented) => {
      const line: WorkingLine = { ...presented };
      delete line.isGift;
      delete line.giftForm;
      delete line.giftUnitPriceGross;
      delete line.itemId;
      delete line.referenceUnitPriceGross;
      return line as FiscalTransactionLine;
    },
  );

  assertLinesSumToTotal(reconciledLines, order.totals, order.id);

  const command: RegisterTransactionCommand = {
    connectionId,
    orderId: order.id,
    idempotencyKey,
    currency: order.totals.currency,
    lines: reconciledLines,
    totalGross: order.totals.total,
  };

  // The sale time is the SOURCE's placement timestamp only. `createdAt` is OL's
  // ingestion clock and must never substitute for when the sale happened.
  if (order.placedAt !== undefined) {
    command.occurredAt = order.placedAt;
  }

  const recipient = toRecipient(order);
  if (recipient) {
    command.recipient = recipient;
  }

  // #2260 review: only when the caller actually has a marker. An absent era is
  // the ordinary case and must stay absent rather than becoming `null` on the
  // wire, exactly as the invoice mapper treats it.
  if (taxRateEra !== undefined && taxRateEra !== null) {
    command.taxRateEra = taxRateEra;
  }

  // #3187, ADR-073 decision 1: decode the persisted three-state column and
  // stamp the command ONLY when there is an actual number to send. Both other
  // states - "asserted none" (`decodeBuyerTaxIdColumn` returns `null`) and
  // "not asserted" (`undefined`) - leave the field absent, the same way an
  // absent `taxRateEra` above stays absent rather than becoming a wire `null`.
  const decodedBuyerTaxId = decodeBuyerTaxIdColumn(buyerTaxId);
  // `decodeBuyerTaxIdColumn` maps an EMPTY column to `null`, but a
  // WHITESPACE-only one decodes to the blank string itself (its guard is
  // `column.length === 0`), so `typeof` alone is not enough: a column holding
  // `'   '` would go out as `consumerTIN: "   "` on a fiscal document. Trim
  // and require something left, which is the same standard the invoice half
  // of this epic (#3224) applies to the same input. `encodeBuyerTaxIdColumn`
  // trims on the ordinary write path, so the state is only reachable through a
  // direct database write - core still does not hand an adapter a value it has
  // not confirmed.
  const trimmedBuyerTaxId =
    typeof decodedBuyerTaxId === 'string' ? decodedBuyerTaxId.trim() : '';
  if (trimmedBuyerTaxId.length > 0) {
    command.buyerTaxId = trimmedBuyerTaxId;
  }

  return command;
}

/**
 * Refuse a sale whose lines contradict its own total.
 *
 * A fiscal registration transmits amounts it must not silently distort, so
 * "the lines sum to the total" has to be CHECKED, not asserted in a comment.
 * Three real ways it breaks today, none of them exotic:
 *
 *   - a source that folds a coupon or an order-level discount into `total`
 *     reports lines that sum higher. `OrderTotals.discountTotal` exists since
 *     5e85a35d7 and the refusal now NAMES it when it accounts for the gap
 *     (#3365) - but only a source that populates it can be named, and a source
 *     that does not still produces this refusal with no cause stated;
 *   - `orderFromReadySnapshot`'s `readTotals` / `readItems` zero-default every
 *     missing numeric, so a partially malformed snapshot composes zero-priced
 *     lines under a non-zero total (or the reverse);
 *   - a source reporting `total` net of something it never itemised.
 *
 * Blocking with an operator-facing 422 is the fiscally correct answer: the
 * alternative is a receipt whose printed lines do not add up to the amount the
 * buyer paid, which no downstream surface can detect or repair.
 *
 * This is arithmetic on figures the SOURCE reported - a sum and a comparison. It
 * neither computes nor infers a tax rate, so it stays clear of ADR-042 decision
 * 8's negative half.
 */
function assertLinesSumToTotal(
  lines: FiscalTransactionLine[],
  totals: Order['totals'],
  orderId: string,
): void {
  const totalGross = totals.total;
  const currency = totals.currency;
  if (!Number.isFinite(totalGross)) {
    throw new InvalidFiscalLineError(
      `Order ${orderId} reports a non-finite gross total; cannot compose a registrable sale`,
    );
  }

  const summed = lines.reduce((sum, line) => sum + line.quantity * line.unitPriceGross, 0);
  if (!Number.isFinite(summed)) {
    throw new InvalidFiscalLineError(
      `Order ${orderId} has a line with a non-finite amount; cannot compose a registrable sale`,
    );
  }

  // #3365 review: the same quantity-scaled bound the invoice half now uses, and
  // for the same reason - both kinds must answer one question about one sale
  // identically, or a figure a receipt accepts is one an invoice refuses.
  const totalQuantity = lines.reduce((sum, line) => sum + line.quantity, 0);
  const epsilon = quantityScaledReconciliationEpsilon(currency, totalQuantity);
  const gap = summed - totalGross;
  if (Math.abs(gap) > epsilon) {
    throw new InvalidFiscalLineError(
      `Order ${orderId} lines sum to ${summed.toFixed(2)} but the order reports a gross total of ` +
        `${totalGross.toFixed(2)}; a fiscal registration may not transmit lines that contradict ` +
        `their own total` +
        // #3365 - the same diagnosis the invoice half already gave. Both
        // contexts share ONE implementation in `sales-documents`, because a
        // fiscal receipt is not an invoice and neither could own the sentence
        // for the other. Taking the whole `totals` rather than a bare number is
        // what makes it reachable at all: the previous signature could not see
        // `discountTotal`, so this refusal named no cause even on a source that
        // reports one.
        describeDiscountCause(totals.discountTotal, gap, epsilon),
    );
  }
}

/**
 * Map an {@link OrderItem} onto a {@link FiscalTransactionLine}. `name` falls
 * back to `sku` then `productId` when the source omitted a label.
 *
 * `taxRate` now carries the rate the order line was settled with (#2252,
 * ADR-063), where it used to be left empty for the adapter's regime mapping to
 * fill. It is a PASSTHROUGH: core still names no rate of its own, and an empty
 * value still reaches the service - which refuses the registration rather than
 * letting the connection's tax letter stand in for one nobody confirmed.
 */
function toFiscalLine(item: OrderItem, orderId: string): FiscalTransactionLine {
  if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
    throw new InvalidFiscalLineError(
      `Order ${orderId} has an item with a non-positive quantity; ` +
        `cannot compose a registrable line`,
    );
  }
  return {
    name: item.name?.trim() || item.sku || item.productId,
    quantity: item.quantity,
    // See the invoicing twin: the source's own gross when it reported one
    // (#3365), otherwise `price`, which is already gross on a gross-priced
    // source. The eligibility guard refuses the order before this point unless
    // one of the two is genuinely a gross figure.
    unitPriceGross: item.unitPriceGross ?? item.price,
    taxRate: item.taxRate?.trim() ?? '',
    sku: item.sku ?? null,
    // Carried so the post-registration stock re-read knows what moved; the
    // shipping lines below deliberately omit it.
    productId: item.productId,
  };
}

/**
 * Apply the delivery to the receipt: returns the complete line list - the
 * product lines followed by the delivery lines, or in `spread` mode new copies
 * of the product lines carrying the raised price and no delivery line. The
 * input lines are never mutated (see the invoicing twin for what the raised
 * price means for a later correction).
 *
 * A receipt registers what was paid, so it never carries a zero delivery line
 * (ADR-082 decision 7) - `freeDelivery` is an invoice-only setting.
 *
 * Every delivery line NAMES its rate (ADR-082 decision 4). A fiscal device
 * binds a name to one rate and refuses it for good once the rate goes up after
 * it went down, so one name at two rates on a mixed basket gets the whole
 * registration rejected; a name that changes with the rate cannot.
 *
 * Shipping inherits the basket's rate in `goods` mode, and a mixed-rate basket
 * splits it in proportion to line gross so the parts sum exactly to what the
 * buyer paid (#2248). When the split is uncomputable, one line with an empty
 * rate is emitted and the service refuses the whole registration; dropping the
 * shipping instead would understate the receipt total.
 */
function applyDelivery(
  productLines: readonly FiscalTransactionLine[],
  order: Order,
  delivery: ResolvedDeliveryLine
): FiscalTransactionLine[] {
  const spread = spreadIntoProductLines(productLines, order, delivery);
  if (spread !== null) return spread;
  return [...productLines, ...deliveryLinesFor(order, delivery)];
}

/**
 * `spread` mode: new product lines carrying their share of the delivery, or
 * `null` when the mode is not `spread`, there is no paid delivery, or the
 * amount cannot be folded in exactly (no quantity-1 line to take the
 * remainder) - the caller then emits a separate delivery line rather than
 * inventing a price.
 */
function spreadIntoProductLines(
  productLines: readonly FiscalTransactionLine[],
  order: Order,
  delivery: ResolvedDeliveryLine
): FiscalTransactionLine[] | null {
  if (delivery.rate !== 'spread') return null;
  const { shipping, exponent } = shippingSplitInputs(order);
  if (!Number.isFinite(shipping) || shipping <= 0) return null;
  const increases = spreadDeliveryAcrossLines(shipping, productLines, exponent);
  if (increases === null) {
    logger.warn(
      `Order ${order.id}: delivery cannot be spread across product lines; ` +
        'falling back to a separate delivery line'
    );
    return null;
  }
  return productLines.map((line, index) => ({
    ...line,
    unitPriceGross: line.unitPriceGross + increases[index],
  }));
}

/** The delivery lines to append after the product lines. */
function deliveryLinesFor(
  order: Order,
  delivery: ResolvedDeliveryLine
): FiscalTransactionLine[] {
  const { lines: splitLines, shipping, exponent } = shippingSplitInputs(order);
  if (!Number.isFinite(shipping) || shipping <= 0) {
    return [];
  }

  if (delivery.rate === 'fixed' && delivery.fixedRate !== undefined) {
    return [
      {
        name: formatReceiptLineName(
          delivery.name,
          delivery.fixedRate,
          delivery.rateFormat,
          delivery.rateLabel,
        ),
        quantity: 1,
        unitPriceGross: shipping,
        taxRate: delivery.fixedRate,
        sku: null,
      },
    ];
  }

  const parts = splitShippingAcrossRates(shipping, splitLines, exponent);

  if (parts === null) {
    // The basket cannot state a rate, but the source may have reported the one
    // it charged on delivery (ADR-063: carried, never computed).
    const sourceRate = order.totals.shippingTaxRate?.trim() ?? '';
    return [
      {
        name: formatReceiptLineName(
          delivery.name,
          sourceRate,
          delivery.rateFormat,
          delivery.rateLabel,
        ),
        quantity: 1,
        unitPriceGross: shipping,
        taxRate: sourceRate,
        sku: null,
      },
    ];
  }

  return parts.map((part) => ({
    name: formatReceiptLineName(
          delivery.name,
          part.taxRate,
          delivery.rateFormat,
          delivery.rateLabel,
        ),
    quantity: 1,
    unitPriceGross: part.amount,
    taxRate: part.taxRate,
    sku: null,
  }));
}

/**
 * Derive the optional delivery target from the order snapshot. Returns `null`
 * when the snapshot carries neither channel - which is normal under a
 * hash-only PII configuration, and is not an error: an adapter whose provider
 * returns the artefact inline needs no target at all.
 */
function toRecipient(order: Order): FiscalRecipient | null {
  const email = order.customerEmail?.trim() || null;
  const phone = order.shippingAddress?.phone?.trim() || null;
  if (email === null && phone === null) {
    return null;
  }
  return { email, phone };
}
