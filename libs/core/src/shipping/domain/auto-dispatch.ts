/**
 * Auto-dispatch parcel derivation (pure) (#3340, closing #2729)
 *
 * A packer should only print and pack. The invoice half of that already works
 * (`config.invoicing.triggerModel = 'auto-on-paid'`); the label had no
 * automatic path at all — `ShipmentDispatchService.dispatch()` was only ever
 * called from two operator-gated HTTP routes. #2729 named the two reasons an
 * automatic trigger could not be built: `parcel` weight/dimensions are
 * operator-typed and derivable from nothing, and `recipient` existed only as
 * a FRONTEND projection (`apps/web/src/features/orders/lib/dispatch-input.ts`),
 * unusable from core per #591. Both are resolved here, in core, so the
 * decision can be made from the worker rather than a browser.
 *
 * Pure functions — no I/O, no framework. The CALLER (`apps/worker`) reads the
 * work's lines, the variants' weights and the order snapshot, and hands the
 * already-resolved facts to these functions; `libs/core/src/shipping` may
 * value-import `@openlinker/core/orders` (an existing, documented edge — see
 * `docs/architecture-overview.md § Cross-context dependencies in core`), but
 * the variant catalogue lookup itself belongs to `products`, which this
 * context does not depend on, so it stays in the worker.
 *
 * ## Dimensions are deliberately NOT summed
 *
 * Stacking boxes is not addition, and getting it wrong is a mispriced label.
 * A carrier that needs a size takes the operator-chosen `parcelTemplate`
 * instead (`Connection.config.autoDispatch.parcelTemplate`,
 * `@openlinker/core/identifier-mapping`'s `readAutoDispatchConfig`).
 *
 * ## Every refusal is named, never silent
 *
 * {@link AutoDispatchRefusalReason} is the closed vocabulary the worker
 * handler logs against and classifies into an ADR-007 outcome. `not-enabled`
 * / `no-weight` / `no-address` are structural — retrying without an operator
 * changing something cannot fix them; `carrier-refused` may or may not be,
 * which is why it is surfaced rather than resolved here.
 *
 * @module libs/core/src/shipping/domain
 */
import { REDACTED_PLACEHOLDER } from '@openlinker/core/orders';
import type { Address, OrderPickupPoint, OrderShipping } from '@openlinker/core/orders';

import type { DeliveryIntent } from './types/delivery-intent.types';
import { DELIVERY_INTENT } from './types/delivery-intent.types';
import type { ShipmentAddress, ShipmentRecipient } from './types/shipment-recipient.types';
import type { ShipmentParcel } from './types/shipment-parcel.types';

/**
 * Why an auto-dispatch attempt did not produce a label.
 *
 * `already-has-label` is not a failure at all — it is the "buy at most once"
 * guard reporting that a shipment already exists for this work — but it is
 * named here anyway because the worker handler's log line and the caller's
 * outcome classification both range over this one union.
 */
export const AutoDispatchRefusalReasonValues = [
  'not-enabled',
  'already-has-label',
  'no-weight',
  'no-address',
  'no-delivery-method',
  'carrier-refused',
  'work-not-eligible',
] as const;
export type AutoDispatchRefusalReason = (typeof AutoDispatchRefusalReasonValues)[number];

/**
 * Locker-vs-courier keyword match. Mirrors
 * `apps/web/src/features/orders/lib/dispatch-input.ts`'s `LOCKER_METHOD_RE`
 * verbatim so the FE's manual Generate-label flow and this automatic trigger
 * agree on what counts as a locker delivery — the operator must never be able
 * to trigger one classification by hand and get the other automatically.
 */
const LOCKER_METHOD_RE = /paczkomat|locker|automat|punkt|pickup|one\s*box|one\s*punkt/i;

/**
 * Resolve the carrier-neutral delivery intent from the order's own
 * source-side shipping reference — the same `classifyDeliveryMethod` /
 * `resolveShippingMethod` rule the FE mirror already applies. A resolved
 * pickup point wins outright (mirrors the FE precedent: `pickupPoint`
 * presence is authoritative over a keyword match on the method name).
 */
export function resolveAutoDispatchDeliveryIntent(
  shipping: OrderShipping | undefined,
  pickupPoint: OrderPickupPoint | undefined,
): DeliveryIntent {
  if (pickupPoint !== undefined) {
    return DELIVERY_INTENT.PickupPoint;
  }
  if (!shipping) {
    return DELIVERY_INTENT.Address;
  }
  const haystack = `${shipping.methodName ?? ''} ${shipping.methodId}`;
  return LOCKER_METHOD_RE.test(haystack) ? DELIVERY_INTENT.PickupPoint : DELIVERY_INTENT.Address;
}

/** The shape of one `FulfillmentWorkLine` this module actually needs. */
export interface AutoDispatchWorkLine {
  readonly productVariantId: string;
  readonly totalQuantity: number;
  readonly cancelledQuantity: number;
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Resolve the parcel for an auto-dispatched label, or `null` on refusal
 * (`no-weight` — the caller attributes the reason).
 *
 * Sums `(totalQuantity - cancelledQuantity) × the variant's own weight` over
 * every line. A line whose variant carries no weight falls back to
 * `defaultWeightGrams`; if that is unset too, the WHOLE parcel is refused
 * rather than partially estimated — the weight decides what the carrier
 * charges, so a mixed known/unknown parcel must not silently average out to
 * "good enough". A line already fully cancelled (`quantity <= 0`) contributes
 * nothing and cannot itself cause a refusal.
 *
 * `variantWeightGrams` is keyed by `productVariantId`; a variant absent from
 * the map is treated identically to one whose `weightGrams` is `null`/unset.
 */
export function resolveAutoDispatchParcel(
  lines: readonly AutoDispatchWorkLine[],
  variantWeightGrams: ReadonlyMap<string, number | null | undefined>,
  options: { parcelTemplate?: string; defaultWeightGrams?: number },
): ShipmentParcel | null {
  let totalWeightGrams = 0;
  for (const line of lines) {
    const quantity = line.totalQuantity - line.cancelledQuantity;
    if (quantity <= 0) {
      continue;
    }
    const variantWeight = variantWeightGrams.get(line.productVariantId);
    const perUnitWeight = isPositiveFiniteNumber(variantWeight)
      ? variantWeight
      : options.defaultWeightGrams;
    if (!isPositiveFiniteNumber(perUnitWeight)) {
      return null;
    }
    totalWeightGrams += perUnitWeight * quantity;
  }
  if (!(totalWeightGrams > 0)) {
    // Every line was already fully cancelled, or the work carries no lines —
    // there is nothing to weigh, and a zero-weight label is not a real parcel.
    return null;
  }

  const parcel: ShipmentParcel = { weightGrams: Math.round(totalWeightGrams) };
  return options.parcelTemplate ? { ...parcel, template: options.parcelTemplate } : parcel;
}

function isIsoAlpha2(code: string): boolean {
  return /^[A-Za-z]{2}$/.test(code);
}

/** An address whose load-bearing fields were PII-redacted carries no deliverable recipient. */
function isRedactedAddress(address: Address): boolean {
  return address.address1 === REDACTED_PLACEHOLDER || address.city === REDACTED_PLACEHOLDER;
}

/**
 * Resolve the recipient for an auto-dispatched label, or `null` on refusal
 * (`no-address` — the caller attributes the reason).
 *
 * Mirrors `apps/web/src/features/orders/lib/dispatch-input.ts`'s
 * `detectMissingFields` + `buildDispatchItem`: email and phone are always
 * required (carriers use them for pickup / delivery notifications); the
 * street/city/postcode/country block is required only for a courier
 * (`'address'`) delivery — a locker shipment is addressed by the locker id,
 * never by a postal address. Under `OL_STORE_PII=false` the persisted address
 * is redacted, so a redacted address is treated as absent rather than sent to
 * a carrier half-formed.
 */
export function resolveAutoDispatchRecipient(input: {
  readonly address: Address | undefined;
  readonly customerEmail: string | undefined;
  readonly deliveryIntent: DeliveryIntent;
}): ShipmentRecipient | null {
  const { address, customerEmail, deliveryIntent } = input;

  if (!customerEmail || customerEmail.trim().length === 0) {
    return null;
  }
  const phone = address?.phone;
  if (!phone || phone.trim().length === 0) {
    return null;
  }
  if (address && isRedactedAddress(address)) {
    return null;
  }

  let shipmentAddress: ShipmentAddress | undefined;
  if (deliveryIntent === DELIVERY_INTENT.Address) {
    if (!address?.address1 || !address.city || !address.postalCode || !address.country) {
      return null;
    }
    if (!isIsoAlpha2(address.country)) {
      return null;
    }
    shipmentAddress = {
      // BE requires both street + buildingNumber non-empty; OL's address1
      // carries street + number combined (the FE precedent), so it is passed
      // to both slots.
      street: address.address1,
      buildingNumber: address.address1,
      city: address.city,
      postCode: address.postalCode,
      countryCode: address.country.toUpperCase(),
    };
  }

  const recipient: ShipmentRecipient = { email: customerEmail, phone };
  if (address?.firstName) recipient.firstName = address.firstName;
  if (address?.lastName) recipient.lastName = address.lastName;
  if (shipmentAddress) recipient.address = shipmentAddress;
  return recipient;
}
