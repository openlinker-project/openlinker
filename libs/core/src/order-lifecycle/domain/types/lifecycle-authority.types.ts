/**
 * Lifecycle Authority (#2305, ADR-059 / ADR-057; design §6.2 R1, REVIEW C6)
 *
 * WHO authors this order's lifecycle facts — OpenLinker itself (posture A), or
 * an external party reached through a named connection (posture B).
 *
 * **The external mode carries a `connectionId`, and that is load-bearing**
 * (design R1 / REVIEW C6): A4 was the one authority in the model without a
 * selection function, which left ADR-057's predicate undecidable — "an external
 * party holds this" is not actionable unless you can say WHICH. With the id,
 * A4 resolves through the same `selectAuthorityHolder()` as every other
 * authority, and ambiguity stays inert the way #2047 established.
 *
 * Read from `Connection.config.lifecycleAuthority` on the **source** connection.
 * It is a property of the channel relationship, defaults to
 * `{ mode: 'openlinker' }` (zero-config), and the fact producer is **bound per
 * order at ingestion and prospective-only thereafter** — flipping the config
 * must never retroactively restate who authored facts already recorded.
 *
 * **This coercer takes the config VALUE, never a `Connection`.** Importing
 * `Connection` from `@openlinker/core/identifier-mapping` would be exactly the
 * sibling-context value edge this leaf exists to not have (ADR-053). The caller
 * — which already holds the connection — reaches in and passes the value.
 *
 * @module libs/core/src/order-lifecycle/domain/types
 * @see docs/architecture/adrs/059-order-lifecycle-derived-phase.md
 */

export const LifecycleAuthorityModeValues = ['openlinker', 'external'] as const;

export type LifecycleAuthorityMode =
  (typeof LifecycleAuthorityModeValues)[number];

/**
 * Discriminated on `mode`: only the `external` arm carries a connection id,
 * so a well-typed `LifecycleAuthority` can never be a half-formed "external,
 * holder unknown".
 */
export type LifecycleAuthority =
  | { mode: 'openlinker' }
  | { mode: 'external'; connectionId: string };

/**
 * The zero-config default: OpenLinker authors the lifecycle (posture A).
 * Frozen because it is handed out by reference from `readLifecycleAuthority`.
 */
export const DEFAULT_LIFECYCLE_AUTHORITY: LifecycleAuthority = Object.freeze({
  mode: 'openlinker',
});

/**
 * Parse an untrusted `config.lifecycleAuthority` value into the union.
 *
 * Follows `parseTriggerModel`'s shape — a pure, single-source-of-truth coercer
 * over an untrusted jsonb knob that **falls back rather than throws**. Extended
 * here for the object case: `external` additionally requires a non-empty string
 * `connectionId`, and an `external` without one falls back to the default
 * instead of yielding a partially-formed authority.
 *
 * Falling back rather than throwing is the deliberate choice: this value is
 * read on the ingestion path, and an operator typo in a jsonb config field must
 * not be able to wedge order ingestion. The cost is that a malformed
 * `external` silently reads as `openlinker`; the surfacing of that (a warning,
 * an operator-visible reason) belongs to the resolution service in `orders`,
 * not to a pure coercer that cannot log.
 */
export function readLifecycleAuthority(value: unknown): LifecycleAuthority {
  if (typeof value !== 'object' || value === null) {
    return DEFAULT_LIFECYCLE_AUTHORITY;
  }

  const { mode, connectionId } = value as {
    mode?: unknown;
    connectionId?: unknown;
  };

  if (mode === 'openlinker') {
    return DEFAULT_LIFECYCLE_AUTHORITY;
  }

  if (
    mode === 'external' &&
    typeof connectionId === 'string' &&
    connectionId.trim() !== ''
  ) {
    return { mode: 'external', connectionId };
  }

  return DEFAULT_LIFECYCLE_AUTHORITY;
}
