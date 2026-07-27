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

/**
 * Default carrier-neutral label for the shipping invoice line (#1517). Core is
 * language-agnostic and has no locale, so this English default is intentionally
 * untranslated; a caller that has a locale can override it via
 * {@link OrderToIssueInvoiceCommandInput.shippingLineName}.
 */
const SHIPPING_LINE_NAME = 'Shipping';

/** Inputs to {@link toIssueInvoiceCommand}. */
export interface OrderToIssueInvoiceCommandInput {
  order: Order;
  connectionId: string;
  /** Scheme-tagged, caller-supplied (the `Order` has none). `null`/absent = B2C. */
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
   * Optional override for the shipping-line label on a fiscal document. Core has
   * no locale, so a caller that does (or that translates for a target market)
   * can supply a localized name here; when absent the neutral English
   * {@link SHIPPING_LINE_NAME} default is used.
   *
   * NOTE: no issuance caller wires this yet (`AutoIssueTriggerService`, the
   * invoicing controller), so today the neutral default is the only live path
   * and a PL/KSeF document still renders "Shipping". This is an intentional seam,
   * not dead code: a localized label needs a locale source that does not exist in
   * core yet (no per-connection locale setting; the provider is the natural owner
   * of national wording per ADR-026). Wiring it is tracked as a follow-up (#1562).
   */
  shippingLineName?: string;
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
  const { order, connectionId, buyerTaxId, documentType, idempotencyKey, shippingLineName, source } =
    input;

  // GROSS-only MVP: an `exclusive` (net) order would mislabel net as gross.
  // Fail loud rather than corrupt totals. Absent treatment = documented gross
  // assumption (marketplaces report buyer-paid gross), so it is accepted.
  if (order.totals.taxTreatment === 'exclusive') {
    throw new UnsupportedPriceTreatmentError(
      `Order ${order.id} is net-priced (taxTreatment "exclusive"); only gross-priced orders are supported`,
    );
  }

  const buyer = buildBuyerProfile(order, buyerTaxId ?? null);
  const lines = order.items.map((item) => toInvoiceLine(item, order.id));

  // Buyer-paid shipping is part of the invoice total (invoice gross must equal
  // order total, #1517). Emit it as a normal gross line so the provider adapter
  // resolves its tax rate the same way it does for product lines; core never
  // names a tax rate. Skipped when shipping is 0 (no phantom line).
  const shippingLine = toShippingLine(order.totals.shipping, shippingLineName);
  if (shippingLine) {
    lines.push(shippingLine);
  }

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

  return command;
}

/**
 * Compose the {@link BuyerProfile}. Address derives from billing, falling back
 * to shipping. The B2B/B2C axis is driven SOLELY by the caller-supplied,
 * scheme-tagged `buyerTaxId` (the `Order` carries none) — never by inspecting
 * the tax id's value. Throws {@link InvalidBuyerProfileError} (PII-clean,
 * cites only `order.id`) when no address or no name can be derived.
 */
function buildBuyerProfile(order: Order, buyerTaxId: TaxIdentifier | null): BuyerProfile {
  const source = order.billingAddress ?? order.shippingAddress;
  if (!source) {
    throw new InvalidBuyerProfileError(
      `Order ${order.id} has no billing or shipping address to derive a buyer profile`,
    );
  }

  const type: BuyerType = buyerTaxId ? 'company' : 'private';
  const name = deriveBuyerName(order, source);
  const address = toBuyerAddress(source);

  // #1797: thread the order's buyer e-mail (already captured from the
  // source platform, #948) into the invoicing domain so providers that
  // support InvoiceEmailSender can actually deliver to a known address.
  return new BuyerProfile(name, buyerTaxId, address, type, order.customerEmail ?? null);
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
 * Map an {@link OrderItem} onto an {@link InvoiceLine}. `unitPriceGross` is the
 * line price (gross — see treatment guard above). `name` falls back to
 * `sku` then `productId` when the source omitted a label. `taxRate` is left
 * empty here — the provider adapter resolves the regime rate; core never names
 * a tax rate on the order contract.
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
    unitPriceGross: item.price,
    taxRate: '',
  };
}

/**
 * Compose the shipping {@link InvoiceLine} from the order's gross shipping cost,
 * or `null` when there is nothing to bill (#1517). A single unit priced at the
 * gross shipping amount; `taxRate` is left empty (provider adapter resolves the
 * regime rate, mirroring {@link toInvoiceLine}). Non-positive or non-finite
 * shipping (0, negative, NaN) yields no line — no phantom shipping line. `name`
 * defaults to the neutral {@link SHIPPING_LINE_NAME} when the caller supplies no
 * (locale-specific) override.
 */
function toShippingLine(shipping: number, name?: string): InvoiceLine | null {
  if (!Number.isFinite(shipping) || shipping <= 0) {
    return null;
  }
  return {
    name: name?.trim() || SHIPPING_LINE_NAME,
    quantity: 1,
    unitPriceGross: shipping,
    taxRate: '',
  };
}
