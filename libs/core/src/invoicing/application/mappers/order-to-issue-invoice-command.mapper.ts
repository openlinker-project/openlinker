/**
 * Order -> IssueInvoiceCommand mapper (command composer)
 *
 * Pure function (no NestJS, no I/O) that composes an `IssueInvoiceCommand` from a
 * core `Order` plus caller-supplied context (connectionId, scheme-tagged buyer
 * tax id, optional documentType, idempotencyKey). All rules are neutral: zero
 * document-type / NIP logic. `documentType` is pass-through ONLY. `Order` carries
 * no scheme-tagged tax id, so `buyerTaxId` is supplied by the caller.
 *
 * @module libs/core/src/invoicing/application/mappers
 */
import type { Address, Order, OrderItem } from '@openlinker/core/orders';

import { BuyerProfile } from '../../domain/entities/buyer-profile.entity';
import type {
  BuyerAddress,
  BuyerType,
  InvoiceLine,
  IssueInvoiceCommand,
  TaxIdentifier,
} from '../../domain/types/invoicing.types';
import { InvalidBuyerProfileError } from './errors/invalid-buyer-profile.error';
import { InvalidInvoiceLineError } from './errors/invalid-invoice-line.error';
import { UnsupportedPriceTreatmentError } from './errors/unsupported-price-treatment.error';
import {
  describeDiscountCause,
  describeNetPricedOrderRefusal,
  quantityScaledReconciliationEpsilon,
  resolveDeliveryLine,
  shippingSplitInputs,
  spreadDeliveryAcrossLines,
  splitShippingAcrossRates,
  type ResolvedDeliveryLine,
} from '@openlinker/core/sales-documents';
import { Logger } from '@openlinker/shared/logging';

const logger = new Logger('OrderToIssueInvoiceCommandMapper');

/** Inputs to {@link toIssueInvoiceCommand}. */
export interface OrderToIssueInvoiceCommandInput {
  order: Order;
  connectionId: string;
  /**
   * Caller-supplied (the `Order` has none). `null`/absent = B2C.
   *
   * The `scheme` is OPTIONAL (#3224): the HTTP path supplies a tagged
   * identifier the operator chose, while the auto-issue path holds only the
   * bare number persisted on `order_records.buyerTaxId` and may not mint a tag
   * (ADR-073 decision 1). Both shapes are valid here; tagging an untagged one
   * is the adapter's job.
   */
  buyerTaxId?: TaxIdentifier | null;
  /** Pass-through ONLY; the adapter derives when absent. */
  documentType?: string;
  idempotencyKey?: string;
  /**
   * Optional neutral order-origin (#1694) — the source connection's
   * `platformType` — threaded onto the command's `source` axis for numbering
   * routing. Caller-resolved (the `Order` carries no origin platformType);
   * absent = numbering falls back past the source axis.
   */
  source?: string;
  /**
   * Legacy single name for the shipping line (`config.invoicing.shippingLineName`,
   * #1517). Used only when no {@link deliveryLine} is supplied; ADR-079
   * decision 5 puts it after the order-source connection's own settings.
   */
  shippingLineName?: string;
  /**
   * The delivery line resolved from the order-source connection's
   * `deliveryOnDocuments` (#3905, ADR-079). An invoice never carries the rate
   * suffix a receipt name does; this supplies the invoice wording, the rate
   * mode and the free-delivery choice. Absent resolves to the legacy name (or
   * `Shipping`) in `goods` mode, which is the pre-#3905 behaviour.
   */
  deliveryLine?: ResolvedDeliveryLine;
  /**
   * The order's `order_records.taxRateEra` marker (#2245 review), passed
   * straight through onto the command so the write-path tax-rate guard can
   * exempt pre-rollout history. Caller-supplied: the `Order` carries no era,
   * and every issuance caller already reads the record.
   */
  taxRateEra?: string | null;
  /**
   * Optional operator-supplied buyer fiscal classification (#1580), forwarded
   * onto the {@link BuyerProfile}. Neutral flags a provider maps to its regime
   * (KSeF → FA(3) `JST`/`GV`). Absent on the auto-issue path (no order source
   * carries them) ⇒ the provider emits its "does not apply" default.
   */
  buyerIsPublicSectorEntity?: boolean;
  buyerIsTaxGroupMember?: boolean;
}

/**
 * Compose an `IssueInvoiceCommand` from an `Order`. Throws `InvalidBuyerProfileError`
 * when no address/buyer-name can be derived, `UnsupportedPriceTreatmentError`
 * when the order is net-priced (`taxTreatment === 'exclusive'`), and
 * `InvalidInvoiceLineError` when an item's quantity is not a positive finite
 * number (#1525). Appends a gross shipping line when `order.totals.shipping > 0`
 * so the invoice total equals the buyer-paid order total (#1517).
 */
export function toIssueInvoiceCommand(
  input: OrderToIssueInvoiceCommandInput,
): IssueInvoiceCommand {
  const {
    order,
    connectionId,
    buyerTaxId,
    documentType,
    idempotencyKey,
    shippingLineName,
    source,
    taxRateEra,
    buyerIsPublicSectorEntity,
    buyerIsTaxGroupMember,
  } = input;

  // GROSS-only: an `exclusive` (net) order would mislabel net as gross. Fail
  // loud rather than corrupt totals. Absent treatment = documented gross
  // assumption (marketplaces report buyer-paid gross), so it is accepted.
  //
  // This checks LINE-level `taxTreatment`, never `totals.totalTaxTreatment`
  // (#2829/#2832) — see `describeNetPricedOrderRefusal`'s doc comment
  // (#2835) for why the latter cannot relax this guard.
  const refusal = describeNetPricedOrderRefusal(order, 'invoiced');
  if (refusal !== null) {
    throw new UnsupportedPriceTreatmentError(refusal);
  }

  const deliveryLine =
    input.deliveryLine ?? resolveDeliveryLine(null, { legacyName: shippingLineName });
  const buyer = buildBuyerProfile(order, buyerTaxId ?? null, {
    isPublicSectorEntity: buyerIsPublicSectorEntity,
    isTaxGroupMember: buyerIsTaxGroupMember,
  });
  const lines = order.items.map((item) => toInvoiceLine(item, order.id));

  // Buyer-paid shipping is part of the invoice total (invoice gross must equal
  // order total, #1517). Emit it as a normal gross line so the provider adapter
  // resolves its tax rate the same way it does for product lines; core never
  // names a tax rate. Skipped when shipping is 0 (no phantom line).
  lines.push(...applyDelivery(lines, order, deliveryLine));

  assertLinesSumToTotal(lines, order.totals, order.id);

  const command: IssueInvoiceCommand = {
    connectionId,
    orderId: order.id,
    buyer,
    currency: order.totals.currency,
    lines,
  };

  // saleDate comes ONLY from the marketplace placement timestamp. When
  // `placedAt` is absent the field stays undefined - `createdAt` is OL's
  // ingestion clock, not the sale date, and must never substitute (#1525).
  if (order.placedAt !== undefined) {
    command.saleDate = toIsoDate(order.placedAt);
    command.saleInstant = order.placedAt;
  }
  // documentType is PASS-THROUGH ONLY. Undefined stays undefined; the adapter
  // derives it. No derivation, no faktura/paragon/NIP vocabulary here.
  if (documentType !== undefined) {
    command.documentType = documentType;
  }
  if (idempotencyKey !== undefined) {
    command.idempotencyKey = idempotencyKey;
  }
  // #1694: order-origin numbering axis. Pass-through only — a blank/absent value
  // stays undefined so routing falls back past the source axis.
  if (source !== undefined && source.trim().length > 0) {
    command.source = source;
  }
  // #2245 review: pass-through only. The write-path guard reads it; nothing
  // else does, and it never reaches a provider or a document.
  if (order.paymentMethod !== undefined && order.paymentMethod !== 'unknown') {
    command.paymentMethod = order.paymentMethod;
  }

  if (taxRateEra !== undefined && taxRateEra !== null) {
    command.taxRateEra = taxRateEra;
  }

  return command;
}

/**
 * Compose the {@link BuyerProfile}. Address derives from billing, falling back
 * to shipping. The B2B/B2C axis is driven SOLELY by the caller-supplied,
 * scheme-tagged `buyerTaxId` (the `Order` carries none) — never by inspecting
 * the tax id's value. Throws {@link InvalidBuyerProfileError} (PII-clean,
 * cites only `order.id`) when no address or no name can be derived.
 */
function buildBuyerProfile(
  order: Order,
  buyerTaxId: TaxIdentifier | null,
  classification: { isPublicSectorEntity?: boolean; isTaxGroupMember?: boolean } = {},
): BuyerProfile {
  const source = order.billingAddress ?? order.shippingAddress;
  if (!source) {
    throw new InvalidBuyerProfileError(
      `Order ${order.id} has no billing or shipping address to derive a buyer profile`,
    );
  }

  // Driven by the PRESENCE OF A VALUE, not by object truthiness: since #3224 a
  // `TaxIdentifier` may arrive untagged, so `{ value: '' }` is a representable
  // shape and would read as a company under a bare truthiness test. The tag is
  // never consulted — an untagged number still identifies a business.
  const type: BuyerType = buyerTaxId !== null && buyerTaxId.value.trim().length > 0
    ? 'company'
    : 'private';
  const name = deriveBuyerName(order, source);
  const address = toBuyerAddress(source);

  // #1797: thread the order's buyer e-mail (already captured from the
  // source platform, #948) into the invoicing domain so providers that
  // support InvoiceEmailSender can actually deliver to a known address.
  return new BuyerProfile(
    name,
    buyerTaxId,
    address,
    type,
    order.customerEmail ?? null,
    classification.isPublicSectorEntity,
    classification.isTaxGroupMember,
  );
}

/**
 * Derive the buyer display name: company wins; otherwise the present person
 * tokens joined (no `undefined undefined`, no trailing token). Throws
 * {@link InvalidBuyerProfileError} when nothing yields a name.
 */
function deriveBuyerName(order: Order, address: Address): string {
  const company = address.company?.trim();
  if (company) {
    return company;
  }

  const person = [address.firstName, address.lastName]
    .map((token) => token?.trim())
    .filter((token): token is string => Boolean(token))
    .join(' ');

  if (!person) {
    throw new InvalidBuyerProfileError(
      `Order ${order.id} has no company or person name to derive a buyer profile`,
    );
  }
  return person;
}

/**
 * Format a timestamp as an ISO 8601 calendar date (`YYYY-MM-DD`).
 *
 * UTC-day semantics, ACCEPTED trade-off (#1525 review, mirrors the
 * `toIsoDateOnly` precedent in `invoicing.controller.ts`): the calendar day is
 * taken from the instant's UTC representation, so an order placed 00:30 local
 * time in UTC+2 reports the PREVIOUS UTC day as the sale date. Doing better
 * would require a seller-timezone setting core does not have; the sale date is
 * legally tolerant of this off-by-one at day boundaries.
 */
function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** Map a core {@link Address} onto the neutral {@link BuyerAddress}. */
function toBuyerAddress(address: Address): BuyerAddress {
  return {
    line1: address.address1,
    line2: address.address2 ?? null,
    city: address.city,
    postalCode: address.postalCode,
    countryIso2: address.country,
  };
}

/**
 * Refuse to compose an invoice whose own lines do not add up to what the order
 * says the buyer paid.
 *
 * The mirror of the fiscal-receipt mapper's guard, which has had one since it
 * shipped; the invoicing mapper had none, so an order whose lines and total
 * disagreed produced a perfectly well-formed invoice for the wrong amount. The
 * realistic cause is a whole-order discount: PrestaShop applies a `CartRule`
 * outside `OrderDetail::setSpecificPrice()`, so the line prices are the
 * pre-discount ones while `total` is net of it, and the invoice then asks the
 * buyer for more than they were charged - with every figure on it internally
 * consistent and nothing downstream able to notice.
 *
 * Blocking is the right answer rather than adjusting: OpenLinker does not know
 * WHICH lines the discount belonged to, and FA(3) can only express a discount
 * per line (`P_10` appears once, inside `FaWiersz`), so folding it would mean
 * inventing an attribution for a legal document. A held order with a stated
 * reason is recoverable; a filed invoice for the wrong amount is not.
 *
 * Arithmetic on figures the SOURCE reported - a sum and a comparison. It
 * neither computes nor infers a tax rate.
 */
function assertLinesSumToTotal(
  lines: readonly InvoiceLine[],
  totals: Order['totals'],
  orderId: string
): void {
  const total = totals.total;
  if (!Number.isFinite(total)) {
    throw new InvalidInvoiceLineError(
      `Order ${orderId} reports a non-finite total; cannot compose an invoice`
    );
  }

  const summed = lines.reduce((sum, line) => sum + line.quantity * line.unitPriceGross, 0);
  if (!Number.isFinite(summed)) {
    throw new InvalidInvoiceLineError(
      `Order ${orderId} has a line with a non-finite amount; cannot compose an invoice`
    );
  }

  // #3365 review: scale the tolerance by total quantity. A composer that rounds
  // a per-unit price and then multiplies it back out carries up to half a minor
  // unit of error PER UNIT - WooCommerce's order source does exactly that - so a
  // flat one-minor-unit bound refused ordinary multi-line orders and told the
  // operator their own shop contradicted itself. The bound is the exact worst
  // case of that round trip rather than a number picked to make a case pass, and
  // it stays too narrow for a whole-order discount to hide inside.
  const totalQuantity = lines.reduce((sum, line) => sum + line.quantity, 0);
  const epsilon = quantityScaledReconciliationEpsilon(totals.currency, totalQuantity);
  const gap = summed - total;
  if (Math.abs(gap) > epsilon) {
    throw new InvalidInvoiceLineError(
      `Order ${orderId} lines sum to ${summed.toFixed(2)} but the order reports a total of ` +
        `${total.toFixed(2)}; an invoice may not state an amount its own lines contradict` +
        describeDiscountCause(totals.discountTotal, gap, epsilon)
    );
  }
}

/**
 * Map an {@link OrderItem} onto an {@link InvoiceLine}. `unitPriceGross` is the
 * line price (gross — see treatment guard above). `name` falls back to
 * `sku` then `productId` when the source omitted a label.
 *
 * `taxRate` now carries the rate the order line was settled with (#2248,
 * ADR-063) instead of the empty string it used to emit. It stays a passthrough:
 * the code was resolved once at ingestion, and this mapper neither derives one
 * nor substitutes a default. An empty value still reaches the adapter unchanged
 * — the gate is what refuses such an order, not this function, because a mapper
 * that threw would turn an operator-fixable data gap into a failed job.
 *
 * Throws {@link InvalidInvoiceLineError} (PII-clean, cites only `orderId`) when
 * the quantity is not a positive finite number - a malformed order snapshot
 * defaults it to 0, and letting that through would corrupt per-unit derivations
 * downstream (division to NaN, #1525).
 */
function toInvoiceLine(item: OrderItem, orderId: string): InvoiceLine {
  if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
    throw new InvalidInvoiceLineError(
      `Order ${orderId} has an item with a non-positive quantity; cannot compose an invoice line`,
    );
  }
  return {
    name: item.name?.trim() || item.sku || item.productId,
    quantity: item.quantity,
    // `price` alone was right only while every issuable order priced its lines
    // gross. A net-priced source now reports its own gross beside the net one
    // (#3365, `OrderItem.unitPriceGross`), and the eligibility guard above has
    // already refused the order unless EVERY line carries it - so the fallback
    // is reached only on a gross-priced source, where `price` IS the gross
    // figure. No arithmetic either way: one of two reported numbers is chosen.
    unitPriceGross: item.unitPriceGross ?? item.price,
    taxRate: item.taxRate?.trim() ?? '',
    // Carried so a provider can emit a real catalogue line rather than a
    // free-text one - see `InvoiceLine.productId`. The shipping lines composed
    // below deliberately omit it: a delivery charge is not a catalogue item.
    productId: item.productId,
    // Present-only, because it genuinely is absent for a simple product. A
    // destination whose catalogue item is the VARIANT rather than the product
    // cannot name the goods without it - see `InvoiceLine.variantId`.
    ...(item.variantId !== undefined && { variantId: item.variantId }),
    orderLineId: item.id,
  };
}

/**
 * Apply the delivery to the invoice: returns the delivery lines to append, and
 * in `spread` mode raises the product lines in place instead and returns none
 * (#1517, #2248, #3905).
 *
 * Shipping inherits the basket's tax treatment, so a single-rate basket yields
 * ONE line at that rate - the ordinary case. A mixed-rate basket yields N lines
 * whose amounts sum exactly to the shipping the buyer paid, split in proportion
 * to what was bought at each rate. The line carries the invoice wording with no
 * rate suffix: on an invoice the rate is its own column (ADR-079 decision 4).
 *
 * Non-positive or non-finite shipping yields no line - no phantom line - unless
 * the operator chose `freeDelivery: 'show'`, which prints a zero line at the
 * basket's dominant rate (or the fixed one) so the document says delivery was
 * free rather than silent about it (ADR-079 decision 7).
 *
 * When the split is uncomputable - some line has no rate - a single line with
 * an EMPTY rate is returned rather than nothing. Dropping the shipping would
 * understate the document total; the gate refuses the order before it reaches
 * a provider.
 *
 * Deliberately never sets {@link InvoiceLine.orderLineId} (#3312): no single
 * `OrderItem` backs a shipping line, so there is no id to carry. Crediting a
 * return against this line is #3290's, not this matcher's, concern.
 */
function applyDelivery(
  lines: InvoiceLine[],
  order: Order,
  delivery: ResolvedDeliveryLine
): InvoiceLine[] {
  const { lines: splitLines, shipping, exponent } = shippingSplitInputs(order);
  const label = delivery.invoiceName;

  if (!Number.isFinite(shipping) || shipping <= 0) {
    if (delivery.freeDelivery !== 'show') return [];
    const rate = delivery.rate === 'fixed' ? delivery.fixedRate : dominantRate(splitLines);
    // An unknowable rate means no honest zero line to print; the order's own
    // product lines already fail the gate if THEY lack one.
    if (rate === undefined || rate === '') return [];
    return [{ name: label, quantity: 1, unitPriceGross: 0, taxRate: rate }];
  }

  if (delivery.rate === 'fixed' && delivery.fixedRate !== undefined) {
    return [{ name: label, quantity: 1, unitPriceGross: shipping, taxRate: delivery.fixedRate }];
  }

  if (delivery.rate === 'spread') {
    const increases = spreadDeliveryAcrossLines(shipping, lines, exponent);
    if (increases !== null) {
      lines.forEach((line, index) => {
        line.unitPriceGross = line.unitPriceGross + increases[index];
      });
      return [];
    }
    logger.warn(
      `Order ${order.id}: delivery cannot be spread across product lines; ` +
        'falling back to a separate delivery line'
    );
  }

  const parts = splitShippingAcrossRates(shipping, splitLines, exponent);

  if (parts === null) {
    // The basket cannot state a rate, but the source may have reported the one
    // it charged on delivery (ADR-063: carried, never computed).
    const sourceRate = order.totals.shippingTaxRate?.trim() ?? '';
    return [{ name: label, quantity: 1, unitPriceGross: shipping, taxRate: sourceRate }];
  }

  return parts.map((part) => ({
    name: label,
    quantity: 1,
    unitPriceGross: part.amount,
    taxRate: part.taxRate,
  }));
}

/** The rate carrying the most gross in the basket, or `undefined` when none is known. */
function dominantRate(
  splitLines: readonly { taxRate: string | null; gross: number }[]
): string | undefined {
  const byRate = new Map<string, number>();
  for (const line of splitLines) {
    if (line.taxRate === null || line.taxRate === '') continue;
    byRate.set(line.taxRate, (byRate.get(line.taxRate) ?? 0) + line.gross);
  }
  let best: string | undefined;
  let bestGross = -1;
  for (const [rate, gross] of byRate) {
    if (gross > bestGross || (gross === bestGross && best !== undefined && rate < best)) {
      best = rate;
      bestGross = gross;
    }
  }
  return best;
}
