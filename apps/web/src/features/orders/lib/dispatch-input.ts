/**
 * Dispatch input + eligibility (shared by single + bulk label flows)
 *
 * Pure, framework-free helpers that turn an `OrderRecord` + its parsed snapshot
 * into the dispatch payload the shipping API consumes, and classify whether an
 * order can be dispatched in a bulk batch. Extracted from `GenerateLabelForm`
 * (#769) so the single-order form and the bulk-dispatch dialog (#1109) produce
 * identical payloads and can't drift. No I/O.
 *
 * @module apps/web/src/features/orders/lib
 */
import type { BulkDispatchItem } from '../../shipments';
import type { OrderRecord } from '../api/orders.types';
import { parseOrderSnapshot, type ParsedOrderSnapshot, type PaymentStatus } from '../api/order-snapshot.schema';

/** Internal locker-vs-courier classification of the order's delivery method. */
export type ResolvedShippingMethod = 'paczkomat' | 'kurier';

/**
 * Locker-method keyword tokens (#954) — mirrors `GenerateLabelForm`. A delivery
 * method whose name/id matches resolves to a pickup point (locker), not a
 * courier doorstep delivery.
 */
const LOCKER_METHOD_RE = /paczkomat|locker|automat|punkt|pickup|one\s*box|one\s*punkt/i;

/** Payment statuses that block dispatch entirely (#938) — FE mirror of the BE
 *  blocking set. `cod` is dispatchable in the single-order flow but excluded
 *  from bulk (handled separately in `classifyDispatchEligibility`). */
export const DISPATCH_BLOCKING_PAYMENT_STATUSES: ReadonlySet<PaymentStatus> = new Set<PaymentStatus>([
  'awaiting',
  'refunded',
]);

export function classifyDeliveryMethod(
  shipping: ParsedOrderSnapshot['shipping'],
): 'locker' | 'courier' | 'unknown' {
  if (!shipping) return 'unknown';
  const haystack = `${shipping.methodName ?? ''} ${shipping.methodId}`;
  return LOCKER_METHOD_RE.test(haystack) ? 'locker' : 'courier';
}

/** Resolve the order's locker-vs-courier method from its snapshot. A resolved
 *  pickup point or a locker-classified method ⇒ paczkomat; else courier. */
export function resolveShippingMethod(snapshot: ParsedOrderSnapshot): ResolvedShippingMethod {
  const hasPickupPoint = snapshot.pickupPoint !== undefined;
  return hasPickupPoint || classifyDeliveryMethod(snapshot.shipping) === 'locker'
    ? 'paczkomat'
    : 'kurier';
}

export interface MissingField {
  id: string;
  message: string;
}

function isIsoAlpha2(code: string): boolean {
  return /^[A-Za-z]{2}$/.test(code);
}

/**
 * Snapshot fields the BE `GenerateLabelDto` requires that the order snapshot
 * didn't supply. Paczkomat shipments skip the address block (parcel goes to the
 * locker). Mirrors `GenerateLabelForm.detectMissingFields`.
 */
export function detectMissingFields(
  snapshot: ParsedOrderSnapshot,
  shippingMethod: ResolvedShippingMethod,
): MissingField[] {
  const missing: MissingField[] = [];
  if (!snapshot.customerEmail) {
    missing.push({ id: 'email', message: 'Buyer email is missing from the order snapshot.' });
  }
  const phone = snapshot.shippingAddress?.phone;
  if (!phone || phone.trim().length === 0) {
    missing.push({ id: 'phone', message: 'Buyer phone is missing from the shipping address.' });
  }
  if (shippingMethod === 'kurier') {
    const a = snapshot.shippingAddress;
    if (!a?.address1) missing.push({ id: 'street', message: 'Shipping street is missing.' });
    if (!a?.city) missing.push({ id: 'city', message: 'Shipping city is missing.' });
    if (!a?.postalCode) missing.push({ id: 'postCode', message: 'Shipping postal code is missing.' });
    if (!a?.country || !isIsoAlpha2(a.country)) {
      missing.push({ id: 'country', message: 'Shipping country must be a 2-letter ISO code (e.g. PL).' });
    }
  }
  return missing;
}

export interface DispatchParcel {
  length: number;
  width: number;
  height: number;
  weightGrams: number;
}

/**
 * Build one order's dispatch payload (minus the batch-level `sourceConnectionId`)
 * from its snapshot + an operator-supplied parcel. The shared payload builder for
 * both the single-order form and the bulk dialog — paczkomat shipments omit the
 * address (parcel goes to the locker); courier shipments require it (the
 * eligibility gate guarantees the fields are present before this is called).
 */
export function buildDispatchItem(args: {
  order: OrderRecord;
  snapshot: ParsedOrderSnapshot;
  shippingMethod: ResolvedShippingMethod;
  parcel: DispatchParcel;
  paczkomatId?: string;
  cod?: { amount: string; currency: string };
}): BulkDispatchItem {
  const { order, snapshot, shippingMethod, parcel, paczkomatId, cod } = args;
  const a = snapshot.shippingAddress;

  const address =
    shippingMethod === 'kurier' && a && a.address1 && a.city && a.postalCode && a.country
      ? {
          // BE requires both street + buildingNumber non-empty; OL's address1
          // carries street + number combined, so pass it to both slots.
          street: a.address1,
          buildingNumber: a.address1,
          city: a.city,
          postCode: a.postalCode,
          countryCode: a.country.toUpperCase(),
        }
      : undefined;

  return {
    sourceDeliveryMethodId: snapshot.shipping?.methodId ?? null,
    orderId: order.internalOrderId,
    deliveryIntent: shippingMethod === 'paczkomat' ? 'pickup_point' : 'address',
    paczkomatId: paczkomatId && paczkomatId.length > 0 ? paczkomatId : undefined,
    recipient: {
      firstName: a?.firstName ?? undefined,
      lastName: a?.lastName ?? undefined,
      email: snapshot.customerEmail ?? '',
      phone: a?.phone ?? '',
      address,
    },
    parcel: {
      dimensions: { length: parcel.length, width: parcel.width, height: parcel.height },
      weightGrams: parcel.weightGrams,
    },
    cod:
      cod && cod.amount.length > 0
        ? { amount: cod.amount.replace(',', '.'), currency: cod.currency }
        : undefined,
  };
}

export const DISPATCH_INELIGIBILITY_REASONS = [
  'missing-recipient',
  'needs-paczkomat',
  'cod',
  'payment-blocked',
  'already-shipped',
  'not-ready',
] as const;
export type DispatchIneligibilityReason = (typeof DISPATCH_INELIGIBILITY_REASONS)[number];

/** Short STATUS-badge label per ineligibility reason. */
export const DISPATCH_INELIGIBILITY_LABEL: Record<DispatchIneligibilityReason, string> = {
  'missing-recipient': 'Missing recipient',
  'needs-paczkomat': 'Needs paczkomat',
  cod: 'COD — enter amount',
  'payment-blocked': 'Payment not cleared',
  'already-shipped': 'Already shipped',
  'not-ready': 'Awaiting mapping',
};

/** One-line reason hint shown under an ineligible row. */
export const DISPATCH_INELIGIBILITY_HINT: Record<DispatchIneligibilityReason, string> = {
  'missing-recipient': 'Recipient data is incomplete — fix at source, then dispatch individually.',
  'needs-paczkomat': 'Buyer locker not resolved — dispatch individually.',
  cod: 'Cash-on-delivery amount needed — dispatch individually.',
  'payment-blocked': 'Payment is not cleared — resolve payment, then dispatch.',
  'already-shipped': 'A shipment already exists for this order.',
  'not-ready': 'Order is still awaiting mapping.',
};

/**
 * Per-order dispatch readiness. Carries the parsed snapshot + resolved method so
 * the bulk dialog renders the row and builds the payload from a single classify
 * call. `eligible: false` rows are surfaced (with `reason`), never dropped.
 */
export interface DispatchEligibility {
  order: OrderRecord;
  snapshot: ParsedOrderSnapshot;
  shippingMethod: ResolvedShippingMethod;
  eligible: boolean;
  reason?: DispatchIneligibilityReason;
  /** Resolved buyer pickup-point id for paczkomat orders (empty for courier). */
  paczkomatId?: string;
}

/**
 * Classify whether an order can be dispatched in a bulk batch. Pure function of
 * the record + its snapshot. Bulk excludes COD and unresolved-paczkomat orders
 * (they need per-order operator input) and surfaces them as "dispatch
 * individually" rather than silently skipping.
 */
export function classifyDispatchEligibility(order: OrderRecord): DispatchEligibility {
  const snapshot = parseOrderSnapshot(order.orderSnapshot);
  const shippingMethod = resolveShippingMethod(snapshot);
  const paczkomatId = snapshot.pickupPoint?.id;
  const base = { order, snapshot, shippingMethod, paczkomatId } as const;

  if (order.fulfillmentState === 'dispatched' || order.fulfillmentState === 'delivered') {
    return { ...base, eligible: false, reason: 'already-shipped' };
  }
  if (order.recordStatus !== 'ready') {
    return { ...base, eligible: false, reason: 'not-ready' };
  }
  if (snapshot.paymentStatus && DISPATCH_BLOCKING_PAYMENT_STATUSES.has(snapshot.paymentStatus)) {
    return { ...base, eligible: false, reason: 'payment-blocked' };
  }
  if (snapshot.paymentStatus === 'cod') {
    return { ...base, eligible: false, reason: 'cod' };
  }
  if (shippingMethod === 'paczkomat' && !paczkomatId) {
    return { ...base, eligible: false, reason: 'needs-paczkomat' };
  }
  if (detectMissingFields(snapshot, shippingMethod).length > 0) {
    return { ...base, eligible: false, reason: 'missing-recipient' };
  }
  return { ...base, eligible: true };
}

// ── Grouping helpers (multi-source fan-out + per-carrier protocol) ──────────

/** Generic stable group-by into a Map (insertion order preserved). */
export function groupBy<T, K>(items: readonly T[], keyFn: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const bucket = map.get(key);
    if (bucket) bucket.push(item);
    else map.set(key, [item]);
  }
  return map;
}

/** Source-connection ids that have reached the per-source selection cap. */
export function sourcesAtCap(
  orders: ReadonlyArray<{ sourceConnectionId: string }>,
  cap: number,
): Set<string> {
  const atCap = new Set<string>();
  for (const [sourceId, group] of groupBy(orders, (o) => o.sourceConnectionId)) {
    if (group.length >= cap) atCap.add(sourceId);
  }
  return atCap;
}

/**
 * Cap a candidate selection to at most `cap` orders per source connection,
 * preserving input order. Used by "select all visible" so a single source can't
 * exceed the per-request limit (#1109 — the cap is per source-group, not global).
 */
export function capSelectionPerSource<T extends { sourceConnectionId: string }>(
  orders: readonly T[],
  cap: number,
): T[] {
  const perSource = new Map<string, number>();
  const kept: T[] = [];
  for (const order of orders) {
    const count = perSource.get(order.sourceConnectionId) ?? 0;
    if (count >= cap) continue;
    perSource.set(order.sourceConnectionId, count + 1);
    kept.push(order);
  }
  return kept;
}
