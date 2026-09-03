/**
 * Authority Holder Selection (#2304, ADR-052 / ADR-053)
 *
 * The pure generalisation of `selectPrimaryInvoicingConnection` (#2047,
 * `invoicing/domain/types/invoicing-primary.types.ts`) from "which connection
 * auto-issues the invoice" to "which connection holds authority X over scope Y".
 * The shipped `resolveSalesDocumentRouting` already mirrors that rule verbatim,
 * so the generalisation has two consumers to keep honest, not one
 * (DESIGN §2.1).
 *
 * Two properties carry over unchanged and are the reason this is worth sharing
 * rather than re-deriving per authority:
 *
 *  - **A single candidate wins regardless of any primary flag.** This is what
 *    keeps a zero-config install byte-identical: an operator who never heard of
 *    the OMS must not silently lose an authority to "nobody set a primary".
 *  - **Ambiguity is inert and reported, never resolved arbitrarily.** An
 *    unrouted order is recoverable by hand; two shipments of one order are not.
 *
 * @module libs/core/src/fulfillment-authority/domain/types
 * @see docs/architecture/adrs/052-independently-assignable-fulfillment-authorities.md
 */

import { type AuthorityScope, authorityScopeKey } from './authority-scope.types';

/**
 * One eligible claimant, reduced to what the choice depends on.
 *
 * Structural on purpose, exactly as `InvoicingConnectionCandidate` is: the rule
 * is a pure function that needs no `Connection` entity, and therefore this leaf
 * needs no cross-context import. The caller has already filtered to active
 * connections that carry the authority's capability (or its config claim) and
 * coerced the flags via `parseAuthorityConfig`.
 *
 * **`isPrimary` is OPTIONAL here, unlike the invoicing precedent's required
 * flag.** That is a deliberate divergence, not an oversight: a generic candidate
 * spans six authorities, and several have no primary axis at all — A3 is granted
 * by handshake per work object and A6 is never assignable away, so demanding the
 * caller supply a meaningless `false` would invite reading it as "explicitly not
 * primary". An absent flag and `false` are treated identically by the rule
 * below; the difference is only in what the caller is asked to assert.
 */
export interface AuthorityHolderCandidate {
  readonly connectionId: string;
  readonly scope: AuthorityScope;
  readonly isPrimary?: boolean;
}

/**
 * Why a selection could not name a single holder.
 *
 * - `no-primary`                    — several claimants in the winning tier, none primary.
 * - `multiple-primaries`            — several claimants in the winning tier, more than one primary.
 * - `multiple-claimants-same-scope` — several claimants on the SAME exact scope. Distinct from
 *   `no-primary` because exact-scope claims are supposed to partition (two claimants on one
 *   location is a misconfiguration to report, not a primary election to hold).
 */
export const AuthorityAmbiguityReasonValues = [
  'no-primary',
  'multiple-primaries',
  'multiple-claimants-same-scope',
] as const;

export type AuthorityAmbiguityReason = (typeof AuthorityAmbiguityReasonValues)[number];

/**
 * Outcome of resolving WHO holds an authority over a requested scope.
 *
 * - `selected`  — exactly one holder; `connectionId` names it and `scope` is the
 *   scope of the winning CLAIM (which may be the enclosing `global`, not the
 *   requested scope — a caller persisting the grant needs to know which).
 * - `none`      — nobody claims it: the authority's default holder applies, which
 *   for every row is today's shipped behaviour.
 * - `ambiguous` — several claim it and no rule singles one out. Holds nothing.
 */
export type AuthorityHolderSelection =
  | { kind: 'selected'; connectionId: string; scope: AuthorityScope }
  | { kind: 'none' }
  | { kind: 'ambiguous'; reason: AuthorityAmbiguityReason; candidateIds: string[] };

/** Does this claim cover the requested scope exactly? */
function coversExactly(claim: AuthorityScope, requested: AuthorityScope): boolean {
  return authorityScopeKey(claim) === authorityScopeKey(requested);
}

/**
 * Pick the single connection holding `kind` over `requestedScope`, from the
 * already-filtered eligible candidates. **Pure, no I/O, never throws** — a
 * malformed candidate list yields an outcome, never an exception, because every
 * caller sits on a path where throwing would convert a reportable
 * misconfiguration into a failed job.
 *
 * The rule, in order:
 *
 *  1. **Filter** to claims that cover the requested scope — either exactly, or
 *     by being an enclosing `global` claim.
 *  2. **Tier.** Any exact-scope claimant beats every `global` claimant outright.
 *     A specific grant is a deliberate operator act; a blanket one is a default,
 *     and a default must never override a specific instruction.
 *  3. **Within the winning tier**: 0 → `none`; 1 → `selected` (primary flag
 *     irrelevant — the #2047 zero-config property); N → the single primary, else
 *     `ambiguous`.
 *
 * A requested scope of `global` makes step 2 degenerate — every surviving claim
 * is `global` — so the function reduces exactly to the invoicing precedent.
 */
export function selectAuthorityHolder(
  candidates: readonly AuthorityHolderCandidate[],
  requestedScope: AuthorityScope,
): AuthorityHolderSelection {
  const exact = candidates.filter((candidate) => coversExactly(candidate.scope, requestedScope));
  const enclosing =
    requestedScope.kind === 'global'
      ? []
      : candidates.filter((candidate) => candidate.scope.kind === 'global');

  const tier = exact.length > 0 ? exact : enclosing;
  const tierIsExact = exact.length > 0;

  if (tier.length === 0) {
    return { kind: 'none' };
  }
  if (tier.length === 1) {
    return { kind: 'selected', connectionId: tier[0].connectionId, scope: tier[0].scope };
  }

  const primaries = tier.filter((candidate) => candidate.isPrimary === true);
  if (primaries.length === 1) {
    return {
      kind: 'selected',
      connectionId: primaries[0].connectionId,
      scope: primaries[0].scope,
    };
  }

  if (primaries.length === 0) {
    // Several claimants on one and the same exact scope is a partitioning
    // failure with its own reason — reporting it as `no-primary` would send an
    // operator hunting for a flag that was never the right remedy.
    const sameExactScope =
      tierIsExact &&
      new Set(tier.map((candidate) => authorityScopeKey(candidate.scope))).size === 1;
    return {
      kind: 'ambiguous',
      reason: sameExactScope ? 'multiple-claimants-same-scope' : 'no-primary',
      candidateIds: tier.map((candidate) => candidate.connectionId),
    };
  }

  return {
    kind: 'ambiguous',
    reason: 'multiple-primaries',
    candidateIds: primaries.map((candidate) => candidate.connectionId),
  };
}
