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
 * (`Connection.config.autoDispatch.parcelTemplate`,
 * `@openlinker/core/identifier-mapping`'s `readAutoDispatchConfig`) or, since
 * #3651, a FIXED box configured on the routing rule for that delivery method
 * (see {@link mergeAutoDispatchParcelOptions}) - never a box derived from items.
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
import type { Address, Order, OrderPickupPoint, OrderShipping } from '@openlinker/core/orders';

import type { DeliveryIntent } from './types/delivery-intent.types';
import { DELIVERY_INTENT } from './types/delivery-intent.types';
import type { ShipmentAddress, ShipmentRecipient } from './types/shipment-recipient.types';
import type { ShipmentDimensions, ShipmentParcel } from './types/shipment-parcel.types';

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
  'no-dimensions',
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
  pickupPoint: OrderPickupPoint | undefined
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
 * Parcel profile of a routing rule, as auto-dispatch consumes it (#3651).
 * Structural on purpose: `shipping` does not import `mappings`, and the
 * mappings type satisfies this shape.
 */
export interface AutoDispatchParcelProfile {
  readonly parcelTemplate: string | null;
  readonly lengthMm: number | null;
  readonly widthMm: number | null;
  readonly heightMm: number | null;
  readonly defaultWeightGrams: number | null;
}

export interface AutoDispatchParcelOptions {
  parcelTemplate?: string;
  defaultWeightGrams?: number;
  dimensions?: ShipmentDimensions;
}

/**
 * Merge the routing rule's parcel profile over the connection-wide
 * `autoDispatch` config, most specific first, per field (#3651). A `null`
 * profile, or a null field on it, falls through to the connection value, so a
 * rule without a profile yields exactly the connection-only options.
 * The box is taken whole from the profile, else whole from the connection
 * default (#3571) - never mixed field by field.
 */
export function mergeAutoDispatchParcelOptions(
  profile: AutoDispatchParcelProfile | null,
  connection: {
    parcelTemplate?: string;
    defaultWeightGrams?: number;
    lengthMm?: number;
    widthMm?: number;
    heightMm?: number;
  }
): AutoDispatchParcelOptions {
  const merged: AutoDispatchParcelOptions = {};
  const template = profile?.parcelTemplate ?? connection.parcelTemplate;
  if (template) merged.parcelTemplate = template;
  const profileWeight = profile?.defaultWeightGrams;
  const weight = isPositiveFiniteNumber(profileWeight)
    ? profileWeight
    : connection.defaultWeightGrams;
  if (weight !== undefined) merged.defaultWeightGrams = weight;
  if (
    profile !== null &&
    isPositiveFiniteNumber(profile.lengthMm) &&
    isPositiveFiniteNumber(profile.widthMm) &&
    isPositiveFiniteNumber(profile.heightMm)
  ) {
    merged.dimensions = {
      length: profile.lengthMm,
      width: profile.widthMm,
      height: profile.heightMm,
    };
  } else if (
    isPositiveFiniteNumber(connection.lengthMm) &&
    isPositiveFiniteNumber(connection.widthMm) &&
    isPositiveFiniteNumber(connection.heightMm)
  ) {
    merged.dimensions = {
      length: connection.lengthMm,
      width: connection.widthMm,
      height: connection.heightMm,
    };
  }
  return merged;
}

/**
 * Whether a resolved parcel is missing what the routed carrier declared it
 * requires (#3651). `requiresDimensions` comes from the adapter's
 * `ParcelRequirementsReader`, never from a carrier name in core.
 */
export function findMissingParcelRequirement(
  parcel: ShipmentParcel,
  requirements: { readonly requiresDimensions: boolean }
): 'dimensions' | null {
  return requirements.requiresDimensions && parcel.dimensions === undefined ? 'dimensions' : null;
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
  options: AutoDispatchParcelOptions
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
  const withTemplate = options.parcelTemplate
    ? { ...parcel, template: options.parcelTemplate }
    : parcel;
  return options.dimensions ? { ...withTemplate, dimensions: options.dimensions } : withTemplate;
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

/**
 * Recipient + delivery shape for one order, derived server-side (#3654).
 *
 * The single derivation shared by the auto-dispatch worker and the bench's
 * label replacement, so a re-bought label is addressed by exactly the rule the
 * first one was. A caller never supplies a recipient: the bench's request body
 * carries parcel data only, which is what keeps a `packer` session from
 * steering a label to an address of its choosing.
 *
 * `recipient` is `null` on refusal (`no-address`).
 */
export interface OrderDispatchTarget {
  readonly deliveryIntent: DeliveryIntent;
  readonly recipient: ShipmentRecipient | null;
  readonly paczkomatId: string | undefined;
}

export function resolveOrderDispatchTarget(
  order: Pick<Order, 'shipping' | 'pickupPoint' | 'shippingAddress' | 'customerEmail'>
): OrderDispatchTarget {
  const deliveryIntent = resolveAutoDispatchDeliveryIntent(order.shipping, order.pickupPoint);
  const recipient = resolveAutoDispatchRecipient({
    address: order.shippingAddress,
    customerEmail: order.customerEmail,
    deliveryIntent,
  });
  return { deliveryIntent, recipient, paczkomatId: order.pickupPoint?.id };
}

// ---------------------------------------------------------------------------
// The decision, once (#2729)
// ---------------------------------------------------------------------------
//
// Three callers need the same answer to "may a label be bought for this work,
// and with which parcel and recipient": the `fulfillment.work.autoDispatch`
// worker handler, the bench's own label route (D46) and the settings preview.
// A decision duplicated across them drifts, and the preview is only worth
// showing if it cannot disagree with the real purchase. So the refusal rules
// live HERE, as plain functions over plain arguments, and each caller is a thin
// loader around them.
//
// Data enters as ARGUMENTS (variant weights, the order, the carrier's declared
// requirements): this context does not depend on `products`, and a
// `shipping -> products` edge would close `products -> listings -> shipping`.
//
// The steps are exported separately because the worker handler must keep its
// historical evaluation ORDER (weight, then the order snapshot read, then the
// address, then the carrier lookup) - a step that throws a retryable error must
// not be reached before a refusal that precedes it. {@link planAutoDispatch}
// composes the same steps in that order for the callers that have every input
// up front.

/** Connection-wide parcel settings the planner reads (a subset of `AutoDispatchConfig`). */
export interface AutoDispatchPlanConfig {
  readonly parcelTemplate?: string;
  readonly defaultWeightGrams?: number;
  readonly lengthMm?: number;
  readonly widthMm?: number;
  readonly heightMm?: number;
}

/**
 * Step 1 - the parcel. `null` is the `no-weight` refusal.
 *
 * The routing rule's parcel profile wins over the connection default, field by
 * field (#3651); see {@link mergeAutoDispatchParcelOptions}.
 */
export function planAutoDispatchParcel(input: {
  readonly lines: readonly AutoDispatchWorkLine[];
  readonly variantWeightGrams: ReadonlyMap<string, number | null | undefined>;
  readonly parcelProfile: AutoDispatchParcelProfile | null;
  readonly config: AutoDispatchPlanConfig;
}): ShipmentParcel | null {
  return resolveAutoDispatchParcel(
    input.lines,
    input.variantWeightGrams,
    mergeAutoDispatchParcelOptions(input.parcelProfile, input.config)
  );
}

export type AutoDispatchTargetPlan =
  | {
      readonly kind: 'ready';
      readonly deliveryIntent: DeliveryIntent;
      readonly recipient: ShipmentRecipient;
      readonly paczkomatId: string | undefined;
    }
  | { readonly kind: 'refused'; readonly reason: 'no-address' };

/** Step 2 - who it is addressed to. `no-address` when no deliverable recipient exists. */
export function planAutoDispatchTarget(
  order: Pick<Order, 'shipping' | 'pickupPoint' | 'shippingAddress' | 'customerEmail'>
): AutoDispatchTargetPlan {
  const { deliveryIntent, recipient, paczkomatId } = resolveOrderDispatchTarget(order);
  if (recipient === null) {
    return { kind: 'refused', reason: 'no-address' };
  }
  return { kind: 'ready', deliveryIntent, recipient, paczkomatId };
}

/**
 * Step 3 - the carrier's declared requirements. `requirements` is `null` when
 * nothing is to be required (an OMP-fulfilled resolution, an adapter that
 * declares none, or no resolvable method - that last one is
 * `no-delivery-method`, decided by `dispatch()`).
 */
export function checkAutoDispatchDimensions(
  parcel: ShipmentParcel,
  requirements: { readonly requiresDimensions: boolean } | null
): 'no-dimensions' | null {
  if (requirements === null) {
    return null;
  }
  return findMissingParcelRequirement(parcel, requirements) === null ? null : 'no-dimensions';
}

export type AutoDispatchPlan =
  | {
      readonly kind: 'ready';
      readonly parcel: ShipmentParcel;
      readonly deliveryIntent: DeliveryIntent;
      readonly recipient: ShipmentRecipient;
      readonly paczkomatId: string | undefined;
    }
  | { readonly kind: 'refused'; readonly reason: 'no-weight' | 'no-address' | 'no-dimensions' };

/**
 * The whole decision for callers that already hold every input: the bench label
 * route and the settings preview. `requirementsFor` maps the resolved delivery
 * intent to the carrier's declared requirements (see
 * {@link checkAutoDispatchDimensions}); it is called only once a recipient
 * exists, so a refusal that precedes it never depends on the carrier lookup.
 */
export function planAutoDispatch(input: {
  readonly lines: readonly AutoDispatchWorkLine[];
  readonly variantWeightGrams: ReadonlyMap<string, number | null | undefined>;
  readonly parcelProfile: AutoDispatchParcelProfile | null;
  readonly config: AutoDispatchPlanConfig;
  readonly order: Pick<Order, 'shipping' | 'pickupPoint' | 'shippingAddress' | 'customerEmail'>;
  readonly requirementsFor: (
    deliveryIntent: DeliveryIntent
  ) => { readonly requiresDimensions: boolean } | null;
}): AutoDispatchPlan {
  const parcel = planAutoDispatchParcel(input);
  if (parcel === null) {
    return { kind: 'refused', reason: 'no-weight' };
  }
  const target = planAutoDispatchTarget(input.order);
  if (target.kind === 'refused') {
    return target;
  }
  if (checkAutoDispatchDimensions(parcel, input.requirementsFor(target.deliveryIntent)) !== null) {
    return { kind: 'refused', reason: 'no-dimensions' };
  }
  return {
    kind: 'ready',
    parcel,
    deliveryIntent: target.deliveryIntent,
    recipient: target.recipient,
    paczkomatId: target.paczkomatId,
  };
}

// ---------------------------------------------------------------------------
// Reading refusals back (#2729)
// ---------------------------------------------------------------------------

/**
 * Who has to act on a refused auto-dispatch.
 *
 * - `needs-input` - nothing will change until an operator does (a missing
 *   weight, an address, a box on the routing rule, a held order, or a job whose
 *   retries are exhausted).
 * - `retrying` - the job is still on the retry ladder; a carrier outage or a
 *   timing race may clear on its own.
 */
export const AutoDispatchRefusalBucketValues = ['needs-input', 'retrying'] as const;
export type AutoDispatchRefusalBucket = (typeof AutoDispatchRefusalBucketValues)[number];

/**
 * The `outcomeReason` strings the auto-dispatch handler writes on a
 * `business_failure`, and the neutral reason each stands for. One table, so the
 * handler and the operator read cannot disagree about a string.
 */
export const AUTO_DISPATCH_OUTCOME_REASONS = {
  auto_dispatch_not_enabled: 'not-enabled',
  auto_dispatch_no_weight: 'no-weight',
  auto_dispatch_no_dimensions: 'no-dimensions',
  auto_dispatch_no_address: 'no-address',
  auto_dispatch_no_delivery_method: 'no-delivery-method',
  auto_dispatch_work_not_eligible: 'work-not-eligible',
  auto_dispatch_shipment_claimed_by_sibling_work: 'shipment-claimed-by-sibling-work',
  auto_dispatch_payload_invalid: 'payload-invalid',
} as const;

export type AutoDispatchOutcomeReason = keyof typeof AUTO_DISPATCH_OUTCOME_REASONS;
export type AutoDispatchRefusalCode =
  | (typeof AUTO_DISPATCH_OUTCOME_REASONS)[AutoDispatchOutcomeReason]
  | 'carrier-refused'
  | 'unknown';

/**
 * Classify an auto-dispatch job into a refusal code + bucket, or `null` when it
 * is not a refusal.
 *
 * - A succeeded `business_failure` is terminal: its `outcomeReason` names the
 *   refusal and the bucket is `needs-input`. An unrecognised reason reads as
 *   `unknown` rather than being dropped - a row an operator cannot see is the
 *   failure this read exists to remove. A succeeded `ok` is not a refusal
 *   (`already-has-label` is a success).
 * - A `dead` job exhausted its retries, so it needs an operator.
 * - Any other non-succeeded job that reached this function carries an error
 *   (the caller filters), which is the retry ladder: `retrying`.
 */
export function classifyAutoDispatchJob(job: {
  readonly status: 'queued' | 'running' | 'succeeded' | 'dead';
  readonly outcome?: string | null;
  readonly outcomeReason?: string | null;
}): { readonly code: AutoDispatchRefusalCode; readonly bucket: AutoDispatchRefusalBucket } | null {
  if (job.status === 'succeeded') {
    if (job.outcome !== 'business_failure') {
      return null;
    }
    const known =
      job.outcomeReason === null || job.outcomeReason === undefined
        ? undefined
        : (AUTO_DISPATCH_OUTCOME_REASONS as Record<string, AutoDispatchRefusalCode>)[
            job.outcomeReason
          ];
    return { code: known ?? 'unknown', bucket: 'needs-input' };
  }
  if (job.status === 'dead') {
    return { code: 'carrier-refused', bucket: 'needs-input' };
  }
  return { code: 'carrier-refused', bucket: 'retrying' };
}
