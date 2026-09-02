/**
 * Routing ship-to — the explicit PII allowlist projection (#2393, ADR-062 Decision 2)
 *
 * A fulfilment router is a connection-backed plugin (ADR-055), so `RoutingInput`
 * is a projection handed to code OpenLinker does not own. ADR-062 Decision 2
 * bounds that exposure: `shipTo` carries only the fields routing can actually
 * filter on, and it is `OL_STORE_PII`-aware with a degraded hash-only shape.
 *
 * **What is bounded here, and what is not.** The SHAPE is bounded by
 * construction — no arm can carry a field its allowlist does not name, and a
 * `tsc` error says so (`Exclude` over each arm's keys, in the spec beside this
 * file; the forbidden-name list is a readability aid on top, never the guard). The FIDELITY of the hashed arm is not: both `storePii`
 * and `addressHash` are supplied by the caller and neither is validated here,
 * because core cannot tell a genuine address hash from any other string. So a
 * caller that resolves the flag wrongly emits a postcode it should not, and one
 * that passes the wrong value emits a useless grouping key. That is #2395's
 * responsibility and is stated rather than implied — a docblock claiming a
 * structural bound the code does not provide is worse than none.
 *
 * The discipline is the MCP tools' — an explicit allowlist, never a spread of a
 * domain shape, so a field added to the underlying address later cannot silently
 * start crossing the port. `get_order` enumerates its line-item fields for
 * exactly this reason.
 *
 * ## Core projects and selects; it never derives
 *
 * `locationHash` is PASSED THROUGH from the caller, never recomputed here.
 * Recomputing it was the shape this file was first written in, and it is wrong
 * in a way nothing would have reported: under `OL_STORE_PII=false` the persisted
 * order snapshot's address has already been through `redactAddress`
 * (`@openlinker/core/orders` — `order-address-redaction.ts`), which replaces
 * `address1` / `city` / `postalCode` with a literal placeholder and keeps only
 * the country. Hashing THAT yields one hash per country, shared by every order
 * in the install — a plausible 64-hex string that groups everything, defeating
 * the only property the single-hash shape claims to preserve.
 *
 * So the caller supplies the hash OpenLinker already persists at ingestion
 * (`customer_address_projections.addressHash`), which exists precisely on a
 * hash-only deployment. Note that no read surface exposes it today —
 * `ICustomerProjectionService` has no address-projection read — so #2395 must
 * add one; naming the column here is a requirement on that slice, not a seam it
 * can already call. `null` when the caller has none — honest, rather than a
 * fabricated grouping key. A consequence worth keeping: this file imports no
 * hashing helper at all, so there is no second call site of the salted rule and
 * no `OL_PII_HASH_SALT` failure reachable from a routing path.
 *
 * ## Why ONE hash and not one per field
 *
 * A hashed postcode admits neither prefix nor range matching, so per-field
 * hashes would LOOK like they preserved zone routing while preserving nothing.
 * One hash states the real cost: equality grouping survives, zone routing does
 * not. A design that misleads is worse than one that degrades.
 *
 * `countryIso2` survives in BOTH arms because a country code is not PII — the
 * redaction rule above already keeps `country` in the clear — and
 * `country-served` is the primary routing filter, so degrading it would make
 * hash-only mode unable to route rather than merely less precise.
 *
 * @module libs/core/src/fulfillment/domain/types
 * @see docs/architecture/adrs/062-trust-posture-authority-holding-capabilities.md
 * @see docs/plans/analysis/DESIGN-oms-authority-model.md §5.3
 */

/**
 * What a caller may hand the projector.
 *
 * Deliberately WIDER than the projection it produces — that difference is the
 * projection. `postalCode` (not `postcode`) matches the spelling the shapes a
 * caller actually holds use: the order snapshot and `RedactableAddress`. ADR-062's
 * prose names the values, not the identifier.
 *
 * `addressHash` is the caller's responsibility to derive; nothing here asserts
 * how, beyond passing it through unchanged.
 */
export interface RoutingShipToSource {
  readonly countryIso2: string;
  readonly postalCode?: string | null;
  readonly city?: string | null;
  readonly addressHash?: string | null;
}

/** The full-fidelity arm, used when the deployment stores PII. */
export interface PlainRoutingShipTo {
  readonly mode: 'plain';
  readonly countryIso2: string;
  readonly postalCode: string | null;
  readonly city: string | null;
}

/** The degraded arm. `locationHash` groups; it cannot be matched by zone. */
export interface HashedRoutingShipTo {
  readonly mode: 'hashed';
  readonly countryIso2: string;
  readonly locationHash: string | null;
}

export type RoutingShipTo = PlainRoutingShipTo | HashedRoutingShipTo;

/**
 * The allowlist, per arm.
 *
 * Exported so the guard is data rather than a restatement: adding a field to
 * `RoutingShipTo` without adding it here fails the spec, which makes widening
 * the projection a deliberate two-place edit.
 */
export const ROUTING_SHIP_TO_ALLOWED_KEYS = {
  plain: ['mode', 'countryIso2', 'postalCode', 'city'],
  hashed: ['mode', 'countryIso2', 'locationHash'],
} as const;

/**
 * Fields that must never cross this port in any arm, in any shape.
 *
 * Buyer identity is not a routing input: no filter or sort in the design's
 * closed vocabulary reads a name, an email or a phone number, and a street
 * address is finer than any of them needs.
 */
export const ROUTING_SHIP_TO_FORBIDDEN_KEYS = [
  'name',
  'firstName',
  'lastName',
  'email',
  'phone',
  'address1',
  'address2',
  'company',
  'taxId',
] as const;

/**
 * Project a source address down to what a router may see.
 *
 * `storePii` is an explicit argument rather than an environment read, which is
 * what keeps this pure and directly testable. A caller resolves it with
 * `getEnvBoolean('OL_STORE_PII', true)` and NOT with `getPiiConfig()`, which
 * throws when `OL_PII_HASH_SALT` is unset regardless of the flag's value and
 * would therefore break routing on an ordinary deployment that never enabled
 * hash-only mode (the precedent, with its own rationale, is
 * `OrderIngestionService`).
 *
 * Pure; the rule for the type it sits with (`engineering-standards.md` § the
 * pure-rule exception to "types only").
 */
export function buildRoutingShipTo(
  source: RoutingShipToSource,
  options: { readonly storePii: boolean },
): RoutingShipTo {
  if (!options.storePii) {
    return {
      mode: 'hashed',
      countryIso2: source.countryIso2,
      // `||`, not `??`: an empty string is not a hash, and forwarding one would
      // group every order that carried it — the very defect this arm's design
      // exists to prevent.
      locationHash: source.addressHash?.trim() || null,
    };
  }

  return {
    mode: 'plain',
    countryIso2: source.countryIso2,
    postalCode: source.postalCode || null,
    city: source.city || null,
  };
}
