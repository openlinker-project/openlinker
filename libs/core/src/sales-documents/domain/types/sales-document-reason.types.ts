/**
 * Sales-Document Reason Types (#2100, ADR-041 decision 11)
 *
 * The two neutral vocabularies that answer "why does this order have no fiscal
 * document?". Both carry the SAME visibility contract (ADR-041 §54/§105):
 * persisted and operator-visible, **never log-only** — "OL silently declined to
 * issue" is exactly as opaque to an operator as a wrong pick would be dangerous.
 *
 * They stay TWO unions rather than one because they answer different questions
 * and are not interchangeable:
 *   - `SalesDocumentUnresolvedReason` — *routing could not decide*; a value the
 *     router returns.
 *   - `SalesDocumentGateBlockReason` — *routing decided (or explicitly did not)
 *     and issuance is still not allowed*; a value the gate produces about state
 *     outside the router's knowledge.
 * Collapsing them would let a caller answer "policy gap or operator-fixable data
 * gap?" only by string-matching. `'unresolved-routing'` is the one BRIDGE value:
 * the gate's record of having blocked on a router `unresolved`, whose own
 * `SalesDocumentUnresolvedReason` travels alongside it in the block detail.
 *
 * This module is a DEPENDENCY-FREE LEAF on purpose — no imports at all — so any
 * context (invoicing, orders, and later the router) can value-import it without
 * closing a CJS module-load cycle.
 *
 * @module libs/core/src/sales-documents/domain/types
 * @see docs/architecture/adrs/041-sales-document-routing-policy.md
 */

/**
 * Why routing could not name a single (document kind, connection) pair.
 *
 * WRITTEN TODAY (#2100): `'ambiguous-connection-no-primary'` only — the
 * pre-router form of the same question, produced when several `Invoicing`
 * connections are active and `config.invoicing.isPrimary` singles none of them
 * out (#2047). It reaches the order paired with the gate's `'unresolved-routing'`
 * bridge value.
 *
 * DECLARED BUT NEVER WRITTEN: the other four need the rule engine that produces
 * them, which is #1908-era work. Declaring the full set now is deliberate — a
 * later reader must not mistake an unwritten value for a bug.
 */
export const SalesDocumentUnresolvedReasonValues = [
  'no-matching-rule',
  'conflicting-rules-equal-priority',
  'ambiguous-connection-no-primary',
  'unsupported-document-kind-on-connection',
  'net-priced-order',
] as const;

export type SalesDocumentUnresolvedReason = (typeof SalesDocumentUnresolvedReasonValues)[number];

/**
 * Why the auto-issue gate issued nothing for an order that otherwise qualifies.
 *
 * WRITTEN TODAY (#2100): `'unresolved-routing'` (paired with the
 * `'ambiguous-connection-no-primary'` routing reason), `'trigger-model-manual'`
 * and `'trigger-model-batched'` — the three reachable non-issuing exits of
 * `AutoIssueTriggerService.onOrderTransition`.
 *
 * DECLARED BUT NEVER WRITTEN, each blocked on a prerequisite ADR-041 names:
 *   - `'missing-required-tax-id'` — needs a buyer tax id on the order contract;
 *     no such field exists on `Order` today.
 *   - `'tax-rate-conflict'`       — needs #2057. An unknown tax rate is currently
 *     indistinguishable from a resolved zero (a failed read returns the number
 *     `0`, which is also a legitimate exemption), so "a channel-reported rate
 *     diverging from the master's" is not computable and the gate would read
 *     "no conflict" on precisely the unknown-rate orders it exists to catch.
 */
export const SalesDocumentGateBlockReasonValues = [
  'unresolved-routing',
  'missing-required-tax-id',
  'tax-rate-conflict',
  'trigger-model-manual',
  'trigger-model-batched',
] as const;

export type SalesDocumentGateBlockReason = (typeof SalesDocumentGateBlockReasonValues)[number];

/**
 * One persisted, operator-visible block.
 *
 * `reason` is always a GATE reason. When it is the bridge value
 * `'unresolved-routing'`, `unresolvedReason` carries the routing reason that
 * travelled alongside it (ADR-041 §107) — that pairing is the whole point of
 * keeping two unions instead of collapsing them, and it is what lets a reader
 * answer "policy gap or operator-fixable data gap?" without string-matching.
 *
 * INVARIANT: `unresolvedReason` is present **iff** `reason === 'unresolved-routing'`.
 * The type cannot express that (a discriminated union here would make every
 * consumer narrow before reading a field that is `undefined` in four of five
 * cases), so it is asserted in the spec and honoured at the two construction
 * sites.
 *
 * `detail` is an optional PII-FREE elaboration carrying the ids / counts the
 * reason alone cannot (e.g. "3 invoicing connections, none marked primary"). It
 * reaches an operator screen verbatim, so it must never carry buyer data,
 * provider error text, or any payload field — ids, counts and neutral vocabulary
 * only, matching the PII-safe log envelope the block sits beside.
 */
export interface SalesDocumentBlock {
  readonly reason: SalesDocumentGateBlockReason;
  readonly unresolvedReason?: SalesDocumentUnresolvedReason;
  readonly detail?: string;
}

/**
 * What the gate concluded about one order transition, as reported to the caller
 * that owns the persistence.
 *
 * Three arms, because "no block" and "could not tell" must not collapse into the
 * same value — that collapse is how a legitimate reason gets erased:
 *
 * - `none`          — nothing is blocking this order. The caller CLEARS any
 *   persisted reason; this is what makes the record self-heal once an operator
 *   fixes the configuration, and it is the ordinary outcome.
 * - `blocked`       — carries the named reason to persist.
 * - `indeterminate` — the gate could not reach a conclusion (a compose/enqueue
 *   error, which may be permanent). The caller LEAVES THE PERSISTED VALUE ALONE.
 *   Clearing here would delete a true reason and replace it with nothing, which
 *   is precisely the silent decline ADR-041 §54 forbids.
 */
export type SalesDocumentBlockOutcome =
  | { kind: 'none' }
  | { kind: 'blocked'; block: SalesDocumentBlock }
  | { kind: 'indeterminate' };

/**
 * Reasons that warrant an install-level alarm — everything except
 * `'trigger-model-manual'`.
 *
 * A manual connection is a deliberate operator choice, so on a manual install
 * EVERY uninvoiced order carries that reason (it is also `parseTriggerModel`'s
 * default for an unconfigured connection). Counting those would put a red
 * "Invoicing blocked 4,312" on a perfectly healthy install and train the
 * operator to ignore the number. The per-order badge still renders manual — it
 * is simply rendered neutral, and never aggregated.
 *
 * Derived from the values array rather than hand-listed, so a reason added to
 * ADR-041's union is attention-worthy by default: opting one out has to be a
 * deliberate edit here.
 */
export const SalesDocumentAttentionReasonValues = SalesDocumentGateBlockReasonValues.filter(
  (reason) => reason !== 'trigger-model-manual',
);

// Emptiness matters here — a consumer builds a SQL `IN (…)` list from this array
// at class-definition time and `IN ()` is a Postgres syntax error — but the guard
// belongs in the spec, not in this file: `sales-document-reason.types.spec.ts`
// pins the array to its exact expected members, which is strictly stronger than a
// non-empty check and costs nothing at runtime. This module's whole value is
// being an inert, dependency-free leaf, so it carries no top-level side effect.

/** Narrow an untrusted string (a persisted column, a query param) to the union. */
export function isSalesDocumentGateBlockReason(
  value: unknown,
): value is SalesDocumentGateBlockReason {
  return (
    typeof value === 'string' &&
    (SalesDocumentGateBlockReasonValues as readonly string[]).includes(value)
  );
}

/** Narrow an untrusted string (a persisted column, a query param) to the union. */
export function isSalesDocumentUnresolvedReason(
  value: unknown,
): value is SalesDocumentUnresolvedReason {
  return (
    typeof value === 'string' &&
    (SalesDocumentUnresolvedReasonValues as readonly string[]).includes(value)
  );
}
