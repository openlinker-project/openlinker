/**
 * Shipping Provider Rejection Exception
 *
 * Single typed rejection seam every shipping adapter throws across when a
 * carrier API rejects a command or an adapter pre-flight check fails on
 * provider-defined constraints. The HTTP controller maps this to 502 Bad
 * Gateway; untyped `Error`s fall through to 500 (logged with stack).
 *
 * **Closed-core, open-runtime** — matches the #576 / #580 / #769 pattern.
 * No per-plugin subclass; plugins discriminate via the structured fields:
 *
 * - `providerName` — free string (no closed `KnownProvider` union); plugins
 *   register their own. Today: `'inpost'`, `'allegro'`.
 * - `providerCode` — discriminator the controller / future operator-facing
 *   UI / structured logs key on. Free string; adapters carry the carrier's
 *   code verbatim. Conventional namespacing (not enforced):
 *     - Carrier-surfaced: whatever the provider returns
 *       (`'DELIVERY_METHOD_NOT_AVAILABLE'`, `'target_point'`, …).
 *     - Adapter pre-flight gates: `'preflight.*'`
 *       (`'preflight.missing-paczkomat-id'`, …).
 *     - Adapter pseudo-codes for malformed-provider-responses: `'command.*'`
 *       (`'command.success-without-shipment-id'`).
 *     - HTTP-error wrapping: `'api.http-{statusCode}'` — dynamic per status
 *       (e.g. `'api.http-400'`, `'api.http-503'`, `'api.http-unknown'`)
 *       so structured logs distinguish carrier-rejected (4xx) from
 *       upstream availability (5xx) at the discriminator level.
 *   The cross-provider conventional codes are enumerated as a closed-core
 *   set in {@link KnownProviderRejectionCodeValues} (export from the
 *   shipping barrel) — useful when consumers want compile-time coverage
 *   on the cross-cutting codes. Plugin-specific and dynamic codes are not
 *   in that set; consumers narrow against `string` for those.
 *   `null` when no actionable code can be derived.
 * - `providerDetails` — open-shape per-plugin payload. Typed as
 *   `Record<string, unknown>` so plugin authors can write any
 *   JSON-serialisable object without ceremony, and consumers get
 *   key-accessible discrimination after narrowing the discriminator
 *   strings. Today's conventions:
 *     - InPost field-validation rejections: `{ fieldErrors: { fieldName: string[] } }`
 *     - InPost paczkomat re-tag: `{ paczkomatId: string, fieldErrors?: … }`
 *     - Allegro command errors: `{ errors: AllegroShipmentCommandError[] }`
 *   Optional — undefined when there's nothing structured to carry.
 *
 *   **Contract (not just convention) — this is a data-exposure boundary.**
 *   The HTTP controller forwards `providerDetails` verbatim into the 502
 *   response body AND logs it via `JSON.stringify`. Adapters MUST therefore
 *   populate it with narrow, deliberately-mapped field-error / discriminator
 *   metadata only. It MUST NOT carry secrets, credentials, buyer PII, echoed
 *   request payloads, or a raw upstream error body — doing so would surface
 *   that data in an API response and in logs, violating the "never return
 *   secrets in API responses" security baseline. Map to an explicit shape;
 *   never spread an unfiltered provider response into this field.
 *
 * `message` is operator-readable verbatim — no prefix. The structured
 * `providerName` already carries the provider context for logs.
 *
 * @module libs/core/src/shipping/domain/exceptions
 */
export class ShippingProviderRejectionException extends Error {
  constructor(
    public readonly providerName: string,
    public readonly providerCode: string | null,
    message: string,
    public readonly providerDetails?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ShippingProviderRejectionException';
    Error.captureStackTrace(this, this.constructor);
  }
}
