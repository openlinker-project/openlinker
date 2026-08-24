/**
 * Fulfillment Authority Block Outcome (#2304, ADR-052 / ADR-053)
 *
 * The reporting vocabulary for "an authority resolved to nothing, and here is
 * why" — the #2100 `SalesDocumentBlockOutcome` shape reused wholesale, because
 * ADR-052's matrix rule (*ambiguity is always inert and reported, never resolved
 * arbitrarily*) is the same rule ADR-041 §54 established for fiscal documents,
 * and a second shape would give operators two vocabularies for one situation.
 *
 * Three properties are carried over deliberately:
 *
 *  - **Two unions, not one.** `…BlockReason` answers "resolution completed and
 *    the authority is still not exercisable"; `…UnresolvedReason` answers
 *    "resolution could not decide". `'unresolved-authority'` is the single
 *    bridge value carrying the second alongside the first, so a reader can tell
 *    a policy gap from an operator-fixable data gap without string-matching.
 *  - **`indeterminate` is a third outcome, not a clear.** A transient failure
 *    leaves any previously persisted reason untouched — clearing on a transient
 *    error erases a true reason and replaces it with silence, which is worse
 *    than a stale one. DESIGN §2.2 states the same rule for a work object whose
 *    holder connection is disabled.
 *  - **The write is level-triggered**: a consumer re-decides and stores the
 *    answer including `none`, which is what clears a reason once the
 *    misconfiguration is fixed.
 *
 * **Every member below is DECLARED AND NEVER WRITTEN in Wave 1a.** Nothing
 * imports this leaf yet; the consuming resolvers live in the owning contexts
 * (ADR-053) and land later. The vocabulary ships first so five contexts adopt
 * one spelling rather than inventing five.
 *
 * @module libs/core/src/fulfillment-authority/domain/types
 * @see docs/architecture/adrs/052-independently-assignable-fulfillment-authorities.md
 */

import type { AuthorityKind } from './authority-kind.types';

/**
 * Why resolution could not decide who holds the authority.
 *
 * Mirrors the `AuthorityHolderSelection` ambiguity reasons plus the two shapes
 * that precede a selection at all.
 */
export const FulfillmentAuthorityUnresolvedReasonValues = [
  /** Several claimants, none primary — `selectAuthorityHolder`'s `no-primary`. */
  'ambiguous-no-primary',
  /** Several claimants, more than one primary — `selectAuthorityHolder`'s `multiple-primaries`. */
  'ambiguous-multiple-primaries',
  /**
   * Several claimants on one and the same exact scope. Exact-scope claims are
   * supposed to partition (DESIGN §2 A1: "two claimants on one location → that
   * location contributes **unknown**, never silently summed").
   */
  'ambiguous-same-scope',
  /**
   * A connection claims the authority in config but its adapter does not carry
   * the gating capability named by `AUTHORITY_KIND_DESCRIPTORS[kind].capability`.
   * Never inferred for a `'config-only'` authority, which has no such gate.
   */
  'claimant-lacks-capability',
  /**
   * The resolved holder's connection could not be resolved for negotiation —
   * `getCapabilityAdapter` is active-only, so a disabled holder is unreachable
   * rather than absent (DESIGN §2.2).
   */
  'holder-connection-unresolvable',
] as const;

export type FulfillmentAuthorityUnresolvedReason =
  (typeof FulfillmentAuthorityUnresolvedReasonValues)[number];

/**
 * Why an authority was not exercised for a subject that otherwise qualifies.
 *
 * `'unresolved-authority'` is the bridge value: it is always paired with a
 * `FulfillmentAuthorityUnresolvedReason` in the same block.
 */
export const FulfillmentAuthorityBlockReasonValues = [
  /** Resolution could not decide; `unresolvedReason` carries which way it failed. */
  'unresolved-authority',
  /**
   * The authority resolved to a holder that is not OL, and the requested act is
   * one OL never delegates — A6 refund trigger (ADR-056). The OMS requests, OL
   * executes or refuses; this is the refusal, persisted.
   */
  'authority-not-delegable',
  /**
   * Every candidate holder rejected or timed out and routing is exhausted, so
   * the work is left `unassigned` and reported — never auto-fulfilled by OL,
   * which would be OL taking an authority it was not granted (DESIGN §2.2).
   */
  'no-candidate-accepted',
  /**
   * The holder resolved cleanly but the subject is in a state that forbids the
   * act (e.g. a cancelled order). Distinct from every ambiguity: nothing about
   * the authority configuration is wrong.
   */
  'subject-state-forbids',
] as const;

export type FulfillmentAuthorityBlockReason =
  (typeof FulfillmentAuthorityBlockReasonValues)[number];

/** One persisted, operator-visible block. */
export interface FulfillmentAuthorityBlock {
  /** Which authority was being resolved. */
  readonly kind: AuthorityKind;
  readonly reason: FulfillmentAuthorityBlockReason;
  /** Set exactly when `reason` is the bridge value `'unresolved-authority'`. */
  readonly unresolvedReason?: FulfillmentAuthorityUnresolvedReason;
  /** Free-text operator detail; never parsed, never a second reason channel. */
  readonly detail?: string;
}

/**
 * What a resolution reports back to its caller, which owns the write.
 *
 * The reporting-rather-than-persisting split is ADR-041 §54's and is kept for
 * its reason: persisting in place would need the owning context's token inside
 * the resolver, closing exactly the DI cycle ADR-053's no-injection invariant
 * exists to prevent.
 */
export type FulfillmentAuthorityBlockOutcome =
  | { kind: 'none' }
  | { kind: 'blocked'; block: FulfillmentAuthorityBlock }
  | { kind: 'indeterminate' };

/** Narrow an untrusted string to a `FulfillmentAuthorityBlockReason`. */
export function isFulfillmentAuthorityBlockReason(
  value: unknown,
): value is FulfillmentAuthorityBlockReason {
  return (
    typeof value === 'string' &&
    (FulfillmentAuthorityBlockReasonValues as readonly string[]).includes(value)
  );
}

/** Narrow an untrusted string to a `FulfillmentAuthorityUnresolvedReason`. */
export function isFulfillmentAuthorityUnresolvedReason(
  value: unknown,
): value is FulfillmentAuthorityUnresolvedReason {
  return (
    typeof value === 'string' &&
    (FulfillmentAuthorityUnresolvedReasonValues as readonly string[]).includes(value)
  );
}
