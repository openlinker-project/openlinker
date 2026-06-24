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
import { UnsupportedPriceTreatmentError } from './errors/unsupported-price-treatment.error';

/** Inputs to {@link toIssueInvoiceCommand}. */
export interface OrderToIssueInvoiceCommandInput {
  order: Order;
  connectionId: string;
  /** Scheme-tagged, caller-supplied (the `Order` has none). `null`/absent = B2C. */
  buyerTaxId?: TaxIdentifier | null;
  /** Pass-through ONLY; the adapter derives when absent. */
  documentType?: string;
  idempotencyKey?: string;
}

/**
 * Compose an `IssueInvoiceCommand` from an `Order`. Throws `InvalidBuyerProfileError`
 * when no address/buyer-name can be derived, and `UnsupportedPriceTreatmentError`
 * when the order is net-priced (`taxTreatment === 'exclusive'`).
 */
export function toIssueInvoiceCommand(
  input: OrderToIssueInvoiceCommandInput,
): IssueInvoiceCommand {
  const { order, connectionId, buyerTaxId, documentType, idempotencyKey } = input;

  // GROSS-only MVP: an `exclusive` (net) order would mislabel net as gross.
  // Fail loud rather than corrupt totals. Absent treatment = documented gross
  // assumption (marketplaces report buyer-paid gross), so it is accepted.
  if (order.totals.taxTreatment === 'exclusive') {
    throw new UnsupportedPriceTreatmentError(
      `Order ${order.id} is net-priced (taxTreatment "exclusive"); only gross-priced orders are supported`,
    );
  }

  const buyer = buildBuyerProfile(order, buyerTaxId ?? null);
  const lines = order.items.map(toInvoiceLine);

  const command: IssueInvoiceCommand = {
    connectionId,
    orderId: order.id,
    buyer,
    currency: order.totals.currency,
    lines,
  };

  // documentType is PASS-THROUGH ONLY. Undefined stays undefined; the adapter
  // derives it. No derivation, no faktura/paragon/NIP vocabulary here.
  if (documentType !== undefined) {
    command.documentType = documentType;
  }
  if (idempotencyKey !== undefined) {
    command.idempotencyKey = idempotencyKey;
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

  return new BuyerProfile(name, buyerTaxId, address, type);
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
 */
function toInvoiceLine(item: OrderItem): InvoiceLine {
  return {
    name: item.name?.trim() || item.sku || item.productId,
    quantity: item.quantity,
    unitPriceGross: item.price,
    taxRate: '',
  };
}
