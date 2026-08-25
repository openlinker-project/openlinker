/**
 * Return Bucket Types
 *
 * The operator-facing partition of returns by whether OL could attribute them to an
 * order (#2332, ADR-060).
 *
 * Two members, and the partition is exhaustive by construction because it is derived
 * from one nullable column — `ReturnRecord.isOrphan()` is the single rule, and this
 * vocabulary only names its two sides. Following the #2100 attention-worthy / routine
 * split rather than inventing a taxonomy: `orphan` is the bucket that needs an operator,
 * `attributed` is the routine remainder.
 *
 * **`'attributed'` has no consumer in THIS slice, and that is deliberate rather than
 * dead vocabulary.** #2334's returns list read is its consumer — it mounts `?bucket=` and
 * validates against `isReturnBucket` instead of restating two string literals in a DTO.
 * A single-membered union would be a filter that cannot filter, so the member ships with
 * the rule that defines it.
 *
 * `isReturnBucket` lives here rather than beside a service under the pure-rule exception
 * in `docs/engineering-standards.md` § *The pure-rule exception to "types only"*: it is
 * the coercion rule for the union it sits with, it is pure, and adding a member means
 * editing both halves in one commit.
 *
 * Domain-only: no framework dependencies.
 *
 * @module domain/types
 * @see docs/architecture/adrs/060-returns-aggregate-above-source-projection.md
 */

/**
 * Which side of the attribution partition a return falls on.
 *
 * `orphan` — `internalOrderId IS NULL`. Persisted, visible, counted, and **blocked from
 * every downstream trigger** (`IReturnsService.assertAttributedForTrigger`).
 * `attributed` — OL knows the order. The ordinary state.
 */
export const ReturnBucketValues = ['orphan', 'attributed'] as const;

export type ReturnBucket = (typeof ReturnBucketValues)[number];

/**
 * Coerce an untrusted string (a query parameter, a stored value) into the union.
 *
 * Returns `false` for anything else rather than defaulting to a member: a bucket filter
 * that silently falls back shows the operator a list they did not ask for.
 */
export function isReturnBucket(value: string): value is ReturnBucket {
  return (ReturnBucketValues as readonly string[]).includes(value);
}
