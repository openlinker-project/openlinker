/**
 * Fulfillment Authority Kinds (#2304, ADR-052)
 *
 * The enumerated vocabulary of what a party may independently be granted
 * authority over. "OMS" is deliberately NOT one thing a connection either holds
 * or does not: ADR-052 models it as six authorities assigned per *what a party
 * physically controls*, because scope-is-physical-control is what dissolves the
 * orphaned-refund problem an order-ownership model creates.
 *
 * Each authority's default holder is today's shipped behaviour, reachable with
 * zero config, and every conflict resolves to inert-and-reported ambiguity (the
 * #2047 rule: an unrouted order is recoverable by hand, a double-shipped one is
 * not).
 *
 * @module libs/core/src/fulfillment-authority/domain/types
 * @see docs/architecture/adrs/052-independently-assignable-fulfillment-authorities.md
 * @see docs/architecture/adrs/053-fulfillment-authority-vocabulary-leaf.md
 */

/**
 * The six independently assignable authorities — ADR-052's matrix rows A1–A6.
 *
 * **On six rather than seven.** ADR-052's decision paragraph (lines 20–25)
 * enumerates six authorities "with invoicing/fiscalization integrated as
 * already resolved by ADR-041", whose router is shipped code rather than a
 * proposal (`evaluateSalesDocumentRules` first, `resolveSalesDocumentRouting`
 * as the fallback, #2161/#2170). DESIGN-oms-authority-model §2.1's owning-context
 * list names A1–A6 only, for the same reason: A7 has an owning context already
 * — `sales-documents` — and resolving it here would give one question two
 * answers.
 *
 * A7 is NOT absent from the design's own tables: §2's matrix carries it as a
 * row, and §2.2 groups it with A1/A2/A5/A6 on the config-vs-handshake axis. It
 * simply carries no `AuthorityKind` member, because nothing in this leaf
 * resolves it. Do not "fix" the count to seven.
 *
 * One member per line, no computed keys: #2311's mirror script reads this array
 * and `AUTHORITY_KIND_DESCRIPTORS` textually.
 */
export const AuthorityKindValues = [
  /** A1 — availability / ATP. Scoped per location; publication per channel. */
  'availability',
  /** A2 — sourcing / routing. Scoped per order, configured per channel. */
  'sourcing',
  /** A3 — fulfillment execution. Scoped per `FulfillmentWork`, granted by handshake. */
  'fulfillment-execution',
  /** A4 — order lifecycle. Scoped per order, by fact class; the holder is a fact producer. */
  'order-lifecycle',
  /** A5 — returns disposition. Scoped per return, configured per channel. */
  'returns-disposition',
  /** A6 — refund trigger. Scoped per payment instrument, and NEVER assignable away from OL. */
  'refund-trigger',
] as const;

export type AuthorityKind = (typeof AuthorityKindValues)[number];

/**
 * How one authority is discovered and where it is enforced.
 *
 * The `{capability, configKey, owningContext}` triple is mandated by the design
 * (DESIGN-oms-authority-model:1078, ADR-052's own row: "the enumerated
 * `AuthorityKindValues` with a per-row mapping (capability name or
 * `'config-only'`, config key, owning context)"). ADR-043 was killed for
 * carrying a never-enumerated authority notion; enumerating the mapping here,
 * machine-readably, is the direct remedy.
 *
 * `capability` is `'config-only'` where no adapter capability gates the
 * authority — the holder is named by configuration alone, not discovered by
 * narrowing a dispatched adapter.
 *
 * **`owningContext` is documentation, not a dependency.** Resolution lives
 * where the write lives (ADR-053); this leaf names the context so a reader can
 * find the enforcement, and imports nothing from it. The named contexts are the
 * design's, and two of them (`fulfillment`, `returns`) do not exist yet.
 */
export interface AuthorityKindDescriptor {
  /** The adapter capability that gates the authority, or `'config-only'`. */
  readonly capability: string;
  /** The `Connection.config` key carrying the operator's claim (see `parseAuthorityConfig`). */
  readonly configKey: string;
  /** The core bounded context that owns resolution and enforcement for this authority. */
  readonly owningContext: string;
}

/**
 * The per-row mapping, one entry per `AuthorityKind`.
 *
 * Config keys for A2/A4/A6 are established HERE — the design names the
 * authorities and the config-vs-handshake split but not the literal keys, so
 * this file is where they become the contract. A wrong string is cheap now and
 * expensive once five contexts read it.
 */
export const AUTHORITY_KIND_DESCRIPTORS: Readonly<Record<AuthorityKind, AuthorityKindDescriptor>> =
  Object.freeze({
    /** A1 — read authority, no write guard. Default: OL's computed `masterStock − stockSafetyBuffer`. */
    availability: Object.freeze({
      capability: 'AvailabilityAuthority',
      configKey: 'availabilityAuthority',
      owningContext: 'inventory',
    }),
    /**
     * A2 — exactly one router per order; ambiguity routes nothing and today's
     * all-destinations fan-out runs untouched. `'config-only'`: per ADR-054/ADR-055
     * the router ships as a connection-backed plugin, so the candidate set is
     * configuration rather than a narrowed capability.
     */
    sourcing: Object.freeze({
      capability: 'config-only',
      configKey: 'sourcingAuthority',
      owningContext: 'fulfillment',
    }),
    /** A3 — one holder per work object, granted by handshake; rejection re-enters routing. */
    'fulfillment-execution': Object.freeze({
      capability: 'FulfillmentExecutor',
      configKey: 'fulfillmentExecutor',
      owningContext: 'fulfillment',
    }),
    /**
     * A4 — the holder produces FACTS; OL still derives the phase. `'config-only'`
     * because the seam is a fact-producer designation, not a capability whose
     * absence could withhold the authority.
     */
    'order-lifecycle': Object.freeze({
      capability: 'config-only',
      configKey: 'orderLifecycleAuthority',
      owningContext: 'orders',
    }),
    /** A5 — one per return; a second enabled claimant is ambiguous and disposition is withheld. */
    'returns-disposition': Object.freeze({
      capability: 'ReturnsAuthority',
      configKey: 'returnsAuthority',
      owningContext: 'returns',
    }),
    /**
     * A6 — **never assignable away from OL** (ADR-056). The key is read so an
     * operator's claim is *observable*, never so it can be honoured: an OMS
     * requests a refund and OL executes or refuses with a persisted reason.
     * `parseAuthorityConfig` documents the same rule at the read site.
     */
    'refund-trigger': Object.freeze({
      capability: 'config-only',
      configKey: 'refundTrigger',
      owningContext: 'orders',
    }),
  });

/** Narrow an untrusted string to an `AuthorityKind`. */
export function isAuthorityKind(value: unknown): value is AuthorityKind {
  return typeof value === 'string' && (AuthorityKindValues as readonly string[]).includes(value);
}
