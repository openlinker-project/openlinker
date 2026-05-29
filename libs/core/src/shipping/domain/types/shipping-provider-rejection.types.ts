/**
 * Shipping Provider Rejection Types
 *
 * Closed-core well-known vocabulary for the open-runtime
 * `ShippingProviderRejectionException.providerCode` discriminator (#885).
 *
 * **Closed core, open runtime** — `providerCode` is `string | null` at the
 * wire level (plugins free-string their own carrier-surfaced codes), but
 * this closed list gives FE / structured-log consumers compile-time
 * coverage on the cross-provider conventional codes. Same pattern as
 * `KnownCarrierValues` from #769.
 *
 * **What's enumerated here:**
 * - Cross-provider pre-flight gates (every shipping adapter has these
 *   shapes today: missing-paczkomat-id, missing-delivery-method-id, etc.).
 * - Conceptually-cross-provider codes the FE may want to render distinct
 *   copy for (`'target_point'` → "pick another locker").
 * - Adapter pseudo-codes for malformed-provider-responses.
 *
 * **What's NOT enumerated:**
 * - Carrier-surfaced codes (the provider's own — `'DELIVERY_METHOD_NOT_AVAILABLE'`,
 *   `'PARCEL_TOO_LARGE'`, …) — adapters carry these verbatim; the set is
 *   open and out of scope for closed-core enumeration.
 * - Dynamic `api.http-{status}` codes (one per HTTP status; computed at
 *   throw time, not enumerated statically).
 *
 * @module libs/core/src/shipping/domain/types
 */
export const KnownProviderRejectionCodeValues = [
  // Cross-provider pre-flight gates (every shipping adapter currently emits
  // these shapes; new plugins should reuse the same code names so consumer
  // logic can narrow without per-plugin branching).
  'preflight.unsupported-method',
  'preflight.missing-recipient-address',
  'preflight.missing-dimensions-or-weight',
  'preflight.missing-parcel-template',
  'preflight.missing-parcel-dimensions',
  'preflight.missing-paczkomat-id',
  'preflight.missing-delivery-method-id',
  // Conceptually-cross-provider rejection (locker unavailable). InPost
  // today; future DPD-direct / ORLEN-direct lockers will emit the same.
  'target_point',
  // Adapter pseudo-codes for malformed provider responses (the provider
  // didn't surface its own code, but the adapter knows what's wrong).
  'command.success-without-shipment-id',
] as const;

/**
 * Closed union of the cross-provider well-known rejection codes. Use this
 * when narrowing the discriminator with compile-time coverage (e.g. an
 * exhaustive `switch` for operator-facing error copy). For the open
 * runtime shape (any plugin-supplied string), keep using `string | null`.
 */
export type KnownProviderRejectionCode = (typeof KnownProviderRejectionCodeValues)[number];
