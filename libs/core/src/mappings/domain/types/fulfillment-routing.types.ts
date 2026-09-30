/**
 * Fulfillment Routing Types
 *
 * Types for the general fulfillment-routing model (#832, epic #732): a
 * connection-scoped mapping of `(orderSource, sourceDeliveryMethod) →
 * fulfillment processor`, generalizing `CarrierMapping` (which hardcodes the
 * OMP-fulfilled Allegro→PrestaShop branch).
 *
 * The rule stores only `{ processorKind, processorConnectionId }`. Two axes
 * are deliberately NOT stored on the rule (see ADR-012):
 * - **OMP destination** is *derived* — for `omp_fulfilled` it is the
 *   processor connection itself; for the other kinds it is the order's
 *   destination set (today: fan-out to all OMP connections).
 * - **Branch-1 destination carrier** is sourced from the co-keyed
 *   `CarrierMapping` (same `(source, method)` key), not duplicated here.
 *
 * `processorKind` is a *stored* operator choice (ADR-012), not derived from a
 * connection's declared capabilities.
 *
 * @module libs/core/src/mappings/domain/types
 */

/**
 * Where the fulfilling connection sits, per ADR-012 / spec §"Is this three
 * capabilities, or one?":
 * - `omp_fulfilled`: the destination OMP ships via its own carrier setup;
 *   OL maps the source method → an OMP carrier (via `CarrierMapping`) and
 *   reads status back. Stays on `OrderProcessorManagerPort` + `CarrierMapping`
 *   — NOT a `ShippingProviderManagerPort` adapter.
 * - `ol_managed_carrier`: OL drives an own-contract carrier integration
 *   (`ShippingProviderManagerPort`, e.g. InPost ShipX, #812).
 * - `source_brokered`: OL drives the order source's own shipping brokerage
 *   (`ShippingProviderManagerPort` hosted on the source connection, e.g.
 *   Allegro Delivery, #833).
 */
export const FulfillmentProcessorKindValues = [
  'omp_fulfilled',
  'ol_managed_carrier',
  'source_brokered',
] as const;

export type FulfillmentProcessorKind = (typeof FulfillmentProcessorKindValues)[number];

/**
 * Named-constant map for `FulfillmentProcessorKind`, so call sites reference
 * kinds by name rather than bare string literals (mirrors `SHIPMENT_STATUS`).
 */
export const FULFILLMENT_PROCESSOR_KIND = {
  OmpFulfilled: 'omp_fulfilled',
  OlManagedCarrier: 'ol_managed_carrier',
  SourceBrokered: 'source_brokered',
} as const satisfies Record<
  'OmpFulfilled' | 'OlManagedCarrier' | 'SourceBrokered',
  FulfillmentProcessorKind
>;

/**
 * Whether a resolution matched a persisted rule or fell back to the
 * OMP-fulfilled default (today's PrestaShop-fulfilled behaviour).
 */
export const FulfillmentRoutingSourceValues = ['rule', 'default'] as const;
export type FulfillmentRoutingSource = (typeof FulfillmentRoutingSourceValues)[number];

/**
 * Parcel shape a routing rule ships with (#3651). Every field is nullable
 * because a carrier needs different things: a locker takes a size `parcelTemplate`,
 * a courier needs a fixed L/W/H box, and `defaultWeightGrams` is the per-unit
 * fallback for a variant with no weight of its own. The box is a fixed size per
 * rule and is NEVER computed from items (carton selection is out of scope).
 *
 * Dimensions are all-or-none; {@link normalizeParcelProfile} enforces that.
 */
export interface FulfillmentParcelProfile {
  parcelTemplate: string | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  defaultWeightGrams: number | null;
}

/** Wire-level bounds shared by the API DTO and the persistence layer (mm / g). */
export const PARCEL_PROFILE_BOUNDS = {
  dimensionMmMax: 5000,
  defaultWeightGramsMax: 100000,
  parcelTemplateMaxLength: 32,
} as const;

/**
 * Collapse a profile to `null` when it carries nothing, so "no profile" has ONE
 * representation and a rule saved with an all-null profile behaves byte-for-byte
 * like a rule saved without one. Returns `'incomplete-dimensions'` when only
 * some of length/width/height are set - a partial box is meaningless to every
 * carrier and would otherwise fail late, at the carrier preflight.
 */
export function normalizeParcelProfile(
  input: Partial<FulfillmentParcelProfile> | null | undefined,
): FulfillmentParcelProfile | null | 'incomplete-dimensions' {
  if (!input) {
    return null;
  }
  const template = input.parcelTemplate?.trim();
  const profile: FulfillmentParcelProfile = {
    parcelTemplate: template ? template : null,
    lengthMm: input.lengthMm ?? null,
    widthMm: input.widthMm ?? null,
    heightMm: input.heightMm ?? null,
    defaultWeightGrams: input.defaultWeightGrams ?? null,
  };
  const dims = [profile.lengthMm, profile.widthMm, profile.heightMm];
  const setDims = dims.filter((d) => d !== null).length;
  if (setDims !== 0 && setDims !== 3) {
    return 'incomplete-dimensions';
  }
  const empty =
    profile.parcelTemplate === null && setDims === 0 && profile.defaultWeightGrams === null;
  return empty ? null : profile;
}

/**
 * Upsert input for a routing rule. `sourceConnectionId` is supplied by the
 * caller of `replaceForConnection` (the connection the rules are scoped to),
 * so it is not repeated here. A stored rule always names a processor, so
 * `processorConnectionId` is required.
 */
export interface FulfillmentRoutingRuleInput {
  sourceDeliveryMethodId: string;
  processorKind: FulfillmentProcessorKind;
  /** The connection that fulfils. For `omp_fulfilled` this is the OMP
   * connection; for the other kinds the carrier / source-broker connection. */
  processorConnectionId: string;
  /** Optional parcel profile (#3651). Absent/null/all-null = no profile. */
  parcelProfile?: Partial<FulfillmentParcelProfile> | null;
}

/**
 * Inputs to resolve a routing decision for an order. Kept as primitives (not
 * the `Order` entity) so the `mappings` context does not couple to `orders`.
 */
export interface FulfillmentRoutingQuery {
  sourceConnectionId: string;
  /** `OrderShipping.methodId`; null when the order carries no method →
   * resolves to the `omp_fulfilled` default. */
  sourceDeliveryMethodId: string | null;
}

/**
 * The resolved routing decision. `source` distinguishes a configured-rule hit
 * from the OMP-fulfilled fallback (no regression to today's behaviour).
 *
 * `processorConnectionId` is null for the `omp_fulfilled` **default** (no rule
 * matched): under today's fan-out there is no single fulfilling OMP, so each
 * destination resolves its own carrier via the existing chain. It is non-null
 * for an explicit rule.
 *
 * `processorAvailable` reports whether the resolved processor connection is
 * currently usable (status `active`). A rule pointing at a now-disabled (or
 * otherwise non-active) processor still matches, but resolves `false` here so
 * downstream reads don't present a dead route as live — mirroring the
 * `status: 'active'` filter `getCandidateProcessors` already applies (#1799).
 * Always `true` for the `default` fallback (no processor to gate).
 */
export interface FulfillmentRoutingResolution {
  processorKind: FulfillmentProcessorKind;
  processorConnectionId: string | null;
  source: FulfillmentRoutingSource;
  processorAvailable: boolean;
  /**
   * The matched rule's parcel profile (#3651); `null` for the `default` source
   * and for a rule saved without one. Auto-dispatch and the label-form prefill
   * read it; it never affects which processor is chosen.
   */
  parcelProfile: FulfillmentParcelProfile | null;
}

/**
 * A processor option the operator may route a source delivery method to,
 * for the routing-config UI (#836). Read-side projection of the SAME
 * compatibility predicate `replaceRules` validates against — so any returned
 * candidate is guaranteed to pass `replaceRules`, and any rejected one is
 * never offered.
 *
 * IDs + kind only by design: the FE resolves the connection's display name
 * (`ConnectionEntityLabel`, name-first) and maps `processorKind → label`
 * client-side, so core takes no dependency on connection naming or i18n.
 */
export interface CandidateProcessor {
  processorKind: FulfillmentProcessorKind;
  processorConnectionId: string;
}
