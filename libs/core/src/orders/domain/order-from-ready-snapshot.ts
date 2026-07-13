/**
 * orderFromReadySnapshot — rehydrate a persisted `ready` OrderRecord into a typed Order (#1119)
 *
 * Pure derivation (no I/O): the only `Order` producer today is private to the
 * ingestion service, so invoicing needs a typed accessor to reconstruct an
 * `Order` from `OrderRecord.orderSnapshot` for command composition. Asserts the
 * record is `ready` (a `recordStatus: 'awaiting_mapping'` snapshot holds a raw
 * IncomingOrder, NOT a resolved Order), rehydrates ISO date strings back to
 * `Date`, and throws `OrderSnapshotUnavailableError` (PII-clean) when buyer
 * identity/address is redacted/missing under the PII-storage configuration.
 *
 * @module libs/core/src/orders/domain
 */
import type { OrderRecord } from './entities/order-record.entity';
import type { Address, Order, OrderItem, OrderTotals } from './types/order.types';
import { OrderSnapshotUnavailableError } from './exceptions/order-snapshot-unavailable.error';

/** The `OrderRecordService.sanitizeAddress` placeholder for a PII-redacted field. */
const REDACTED = '[REDACTED]';

/**
 * Reconstruct a typed {@link Order} from a `ready` {@link OrderRecord}.
 *
 * @throws {OrderSnapshotUnavailableError} when the record is not `ready`, or its
 *   buyer identity/address is redacted/missing so no buyer profile can derive.
 */
export function orderFromReadySnapshot(record: OrderRecord): Order {
  if (record.recordStatus !== 'ready') {
    throw new OrderSnapshotUnavailableError(
      record.internalOrderId,
      'order record is not in `ready` recordStatus (snapshot holds a raw incoming order, not a resolved order)',
    );
  }

  const snapshot = record.orderSnapshot;

  const billingAddress = readAddress(snapshot.billingAddress);
  const shippingAddress = readAddress(snapshot.shippingAddress);

  // The command composer derives the buyer profile from billing, falling back to
  // shipping. When PII storage is off, addresses are persisted with `[REDACTED]`
  // placeholders, so no usable buyer profile can be reconstructed. Fail PII-clean
  // (cites only the order id) rather than emit a `[REDACTED]` buyer onto a fiscal
  // document.
  const usable = firstUsableAddress(billingAddress, shippingAddress);
  if (!usable) {
    throw new OrderSnapshotUnavailableError(
      record.internalOrderId,
      'no usable buyer address in the order snapshot (missing or PII-redacted)',
    );
  }

  const order: Order = {
    id: asString(snapshot.id, record.internalOrderId),
    status: asString(snapshot.status, 'unknown'),
    items: readItems(snapshot.items),
    totals: readTotals(snapshot.totals),
    createdAt: asDate(snapshot.createdAt, record.createdAt),
    updatedAt: asDate(snapshot.updatedAt, record.updatedAt),
  };

  if (typeof snapshot.orderNumber === 'string') {
    order.orderNumber = snapshot.orderNumber;
  }
  // placedAt is optional on Order (unlike createdAt/updatedAt) so there is no
  // record-level fallback to substitute - a snapshot without it stays without
  // it (invoicing then omits the sale date rather than guessing, #1525).
  const placedAt = asOptionalDate(snapshot.placedAt);
  if (placedAt !== undefined) {
    order.placedAt = placedAt;
  }
  if (typeof snapshot.customerId === 'string') {
    order.customerId = snapshot.customerId;
  }
  if (billingAddress) {
    order.billingAddress = billingAddress;
  }
  if (shippingAddress) {
    order.shippingAddress = shippingAddress;
  }

  return order;
}

/** Pick the first address the command composer would accept (billing wins). */
function firstUsableAddress(
  billing: Address | undefined,
  shipping: Address | undefined,
): Address | undefined {
  if (billing && !isRedactedAddress(billing)) {
    return billing;
  }
  if (shipping && !isRedactedAddress(shipping)) {
    return shipping;
  }
  return undefined;
}

/** An address whose load-bearing fields were PII-redacted yields no buyer profile. */
function isRedactedAddress(address: Address): boolean {
  return address.address1 === REDACTED || address.city === REDACTED;
}

/** Narrow an unknown snapshot value into an {@link Address}; `undefined` when absent/malformed. */
function readAddress(value: unknown): Address | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.address1 !== 'string' || typeof raw.city !== 'string') {
    return undefined;
  }
  const address: Address = {
    address1: raw.address1,
    city: raw.city,
    postalCode: typeof raw.postalCode === 'string' ? raw.postalCode : '',
    country: typeof raw.country === 'string' ? raw.country : '',
  };
  if (typeof raw.firstName === 'string') address.firstName = raw.firstName;
  if (typeof raw.lastName === 'string') address.lastName = raw.lastName;
  if (typeof raw.company === 'string') address.company = raw.company;
  if (typeof raw.address2 === 'string') address.address2 = raw.address2;
  if (typeof raw.state === 'string') address.state = raw.state;
  if (typeof raw.phone === 'string') address.phone = raw.phone;
  return address;
}

/** Narrow the snapshot's `items` array into typed {@link OrderItem}s. */
function readItems(value: unknown): OrderItem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((raw): OrderItem => {
    const item = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    const orderItem: OrderItem = {
      id: asString(item.id, ''),
      productId: asString(item.productId, ''),
      quantity: typeof item.quantity === 'number' ? item.quantity : 0,
      price: typeof item.price === 'number' ? item.price : 0,
    };
    if (typeof item.variantId === 'string') orderItem.variantId = item.variantId;
    if (typeof item.sku === 'string') orderItem.sku = item.sku;
    if (typeof item.name === 'string') orderItem.name = item.name;
    if (typeof item.imageUrl === 'string') orderItem.imageUrl = item.imageUrl;
    return orderItem;
  });
}

/** Narrow the snapshot's `totals` object into typed {@link OrderTotals}. */
function readTotals(value: unknown): OrderTotals {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const totals: OrderTotals = {
    subtotal: typeof raw.subtotal === 'number' ? raw.subtotal : 0,
    tax: typeof raw.tax === 'number' ? raw.tax : 0,
    shipping: typeof raw.shipping === 'number' ? raw.shipping : 0,
    total: typeof raw.total === 'number' ? raw.total : 0,
    currency: typeof raw.currency === 'string' ? raw.currency : '',
  };
  if (raw.taxTreatment === 'inclusive' || raw.taxTreatment === 'exclusive') {
    totals.taxTreatment = raw.taxTreatment;
  }
  return totals;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

/**
 * Nullable variant of {@link asDate}: rehydrate an ISO date string (the
 * persisted snapshot shape) or a `Date` instance to a VALID `Date`, or
 * `undefined` when the value is absent/unparseable/invalid - the no-fallback
 * semantics optional fields like `placedAt` need (#1525 review round 2).
 */
function asOptionalDate(value: unknown): Date | undefined {
  if (typeof value !== 'string' && !(value instanceof Date)) {
    return undefined;
  }
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/** Rehydrate an ISO date string (the persisted snapshot shape) back to a `Date`. */
function asDate(value: unknown, fallback: Date): Date {
  return asOptionalDate(value) ?? fallback;
}
