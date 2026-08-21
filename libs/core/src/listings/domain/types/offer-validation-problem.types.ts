/**
 * Offer Validation Problems
 *
 * The neutral vocabulary for "why can this listing not sell?", plus the pure
 * helpers that read and partition it (#2231). Lives beside
 * `offer-lifecycle.types.ts` for the same reason that file gives: the rule is
 * unit-testable in TypeScript rather than restated per consumer - mirroring the
 * `pricing-rule.types.ts` / `stock-safety-buffer.types.ts` precedent.
 *
 * A marketplace does not only report offer-level refusals. Some describe the
 * SELLER ACCOUNT - the shop is unverified, suspended, switched off - and when
 * one of those is live it is reported against every one of the seller's offers.
 * Rendering it per row stamps the same sentence on every row and buries the one
 * fact an operator can act on, so the two must be separable.
 *
 * The split is keyed on {@link OfferValidationScope}, a field the ADAPTER sets,
 * never on a list of platform codes held here: only the adapter knows its own
 * taxonomy, and a core-side code list would put marketplace vocabulary in
 * `libs/core`. An adapter that says nothing normalises to `'offer'`, which is
 * both the conservative reading (attribute the problem to the thing in front of
 * the operator) and byte-identical to pre-#2231 behaviour.
 *
 * @module libs/core/src/listings/domain/types
 * @see {@link resolveOfferLifecycle} for the bucket a problem-carrying snapshot lands in
 */
import type { OfferStatusSnapshotDetails } from './offer-status-snapshot.types';

/**
 * Who the problem is about.
 *
 * - `offer` - this listing. Fixing it is a per-offer action.
 * - `account` - the seller's account/shop on the channel. Every offer on the
 *   connection reports it, and fixing it fixes all of them at once.
 */
export const OfferValidationScopeValues = ['offer', 'account'] as const;
export type OfferValidationScope = (typeof OfferValidationScopeValues)[number];

/**
 * One reason a listing cannot sell, normalised for persistence and for the read
 * surfaces.
 *
 * `code` is the platform's OWN value, verbatim and untranslated - it is what an
 * operator quotes in a support ticket and what a maintainer greps for in the
 * platform's docs, so it must survive the round trip even when OL has no
 * sentence for it.
 */
export interface OfferValidationProblem {
  /**
   * The platform's own code, verbatim. Never invented, never translated.
   *
   * OPTIONAL, so the type carries the rule rather than each surface remembering
   * it: a legacy snapshot holds flattened sentences with no code at all, and an
   * empty-string sentinel would reach a React `key` and the panel's raw-code
   * span looking like a code the operator could search for. Absent means "the
   * platform reported no code", and every writer here normalises a blank one to
   * absent so there is one representation of that.
   */
  code?: string;
  /**
   * One short line, for a surface with exactly one line to spend (the
   * `/listings` row). Absent when the adapter supplied only a full sentence;
   * a consumer then falls back to {@link OfferValidationProblem.message}.
   */
  summary?: string;
  /** The operator-facing sentence: what is wrong and what to change. */
  message: string;
  scope: OfferValidationScope;
}

export function isOfferValidationScope(value: unknown): value is OfferValidationScope {
  return typeof value === 'string' && (OfferValidationScopeValues as readonly string[]).includes(value);
}

/**
 * Normalise a platform-reported validation error into a problem. `scope`
 * defaults to `'offer'`; an adapter that predates the field therefore keeps
 * behaving exactly as it did.
 */
export function toOfferValidationProblem(error: {
  code?: string;
  message: string;
  summary?: string;
  scope?: OfferValidationScope;
}): OfferValidationProblem {
  // A blank code is normalised to absent, not stored as `''`: the two mean the
  // same thing to every reader, and one representation is what keeps a surface
  // from having to test truthiness where it tests presence.
  const code = error.code?.trim();
  return {
    ...(code === undefined || code === '' ? {} : { code }),
    ...(error.summary === undefined ? {} : { summary: error.summary }),
    message: error.message,
    scope: error.scope ?? 'offer',
  };
}

/**
 * Read the structured problems off a snapshot's detail blob.
 *
 * Guarded element by element for the same reason `readValidationMessages` is:
 * `statusDetails` is unconstrained `jsonb`, so the declared type is trusted by
 * the compiler and enforced by nothing. A malformed element is dropped rather
 * than half-typed onto a render path - a `code` that is not a string would
 * reach a `key` prop and a `message` that is not a string would reach the DOM.
 * `message` is the field a problem cannot do without; a missing or blank `code`
 * is normalised away rather than dropping the sentence with it.
 *
 * A snapshot written before #2231 carries no `validationProblems` at all and
 * yields `[]`; consumers fall back to `validationMessages`, i.e. to exactly
 * what they rendered before. A row written by an older build of #2231 may hold
 * `code: ''`, which normalises to absent here.
 */
export function readValidationProblems(
  statusDetails: OfferStatusSnapshotDetails | null
): readonly OfferValidationProblem[] {
  const raw = statusDetails?.validationProblems;
  if (!Array.isArray(raw)) return [];
  const problems: OfferValidationProblem[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') continue;
    const candidate = entry as Partial<OfferValidationProblem>;
    if (typeof candidate.message !== 'string') continue;
    const code = typeof candidate.code === 'string' ? candidate.code.trim() : '';
    problems.push({
      ...(code === '' ? {} : { code }),
      ...(typeof candidate.summary === 'string' ? { summary: candidate.summary } : {}),
      message: candidate.message,
      // An unrecognised scope reads as `offer`: attributing an account problem
      // to one offer over-reports it, which is recoverable, where the reverse
      // hides a shop-wide block behind a row nobody opens.
      scope: isOfferValidationScope(candidate.scope) ? candidate.scope : 'offer',
    });
  }
  return problems;
}

/**
 * Partition problems by who they are about, so a caller can render the two
 * where they belong: offer-scoped on the row, account-scoped once per
 * connection.
 */
export function splitOfferValidationProblems(problems: readonly OfferValidationProblem[]): {
  offerProblems: readonly OfferValidationProblem[];
  accountProblems: readonly OfferValidationProblem[];
} {
  const offerProblems: OfferValidationProblem[] = [];
  const accountProblems: OfferValidationProblem[] = [];
  for (const problem of problems) {
    (problem.scope === 'account' ? accountProblems : offerProblems).push(problem);
  }
  return { offerProblems, accountProblems };
}
