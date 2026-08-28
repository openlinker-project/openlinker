/**
 * Authority Questions (#2351, ADR-052 / ADR-053)
 *
 * The seven questions the operator actually asks — Wave-2 product spec §3.3's
 * "Who decides what" table, one member per row. This is the vocabulary
 * `resolveAuthorities` answers.
 *
 * ## Seven questions, six authorities — and why that is not a mistake
 *
 * `AuthorityQuestionValues` has SEVEN members; `AuthorityKindValues` has SIX,
 * and its file says in terms: *"Do not 'fix' the count to seven."* Both are
 * right, because they enumerate different things.
 *
 * A7 ("who issues invoices and receipts?") is a question an operator asks and a
 * row the surface must render. It is NOT an `AuthorityKind`, because it already
 * has an owning context — `sales-documents`, whose router is shipped code
 * (`evaluateSalesDocumentRules` / `resolveSalesDocumentRouting`, #2161/#2170).
 * Giving it a kind here would give one question two answers, which is the exact
 * failure ADR-053's "resolution lives where the write lives" rule exists to
 * prevent. So the seventh question resolves to a **link**, never a mirrored
 * answer, and carries `kind: null`.
 *
 * The invariant that keeps the two lists honest — the six non-null kinds are
 * exactly `AuthorityKindValues`, in order — is asserted by this file's spec, so
 * a seventh authority added later cannot silently leave a question unmapped.
 *
 * One member per line, no computed keys and no spread of `AuthorityKindValues`:
 * the repo's mirror scripts read these arrays **textually**, and a computed
 * array is unreadable to them and to the next human.
 *
 * @module libs/core/src/fulfillment-authority/domain/types
 * @see docs/architecture/adrs/052-independently-assignable-fulfillment-authorities.md
 */

import type { AuthorityKind } from './authority-kind.types';

/**
 * The seven rows of spec §3.3, in the order the table renders them.
 *
 * Six share a spelling with their `AuthorityKind`; `'sales-documents'` is the
 * seventh and names the context that owns its answer rather than an authority.
 */
export const AuthorityQuestionValues = [
  /** A1 — "How much stock can we promise?" */
  'availability',
  /** A2 — "Where does an order ship from?" */
  'sourcing',
  /** A3 — "Who picks and ships?" */
  'fulfillment-execution',
  /** A4 — "What state is an order in?" */
  'order-lifecycle',
  /** A5 — "What happens to returned goods?" */
  'returns-disposition',
  /** A6 — "Who issues refunds?" Never assignable (ADR-056). */
  'refund-trigger',
  /** A7 — "Who issues invoices and receipts?" Answered by `sales-documents`. */
  'sales-documents',
] as const;

export type AuthorityQuestion = (typeof AuthorityQuestionValues)[number];

/** ADR-052 matrix row labels, so a reader can cross-reference the design. */
export const AuthorityMatrixRowValues = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7'] as const;

export type AuthorityMatrixRow = (typeof AuthorityMatrixRowValues)[number];

export interface AuthorityQuestionDescriptor {
  /**
   * The authority this question resolves, or `null` for A7 — whose answer is
   * owned by `sales-documents` and is reached by a link, not by resolution.
   */
  readonly kind: AuthorityKind | null;
  /** The ADR-052 matrix row this question corresponds to. */
  readonly matrixRow: AuthorityMatrixRow;
}

/** One entry per `AuthorityQuestion`, in the same order. */
export const AUTHORITY_QUESTION_DESCRIPTORS: Readonly<
  Record<AuthorityQuestion, AuthorityQuestionDescriptor>
> = Object.freeze({
  availability: Object.freeze({ kind: 'availability', matrixRow: 'A1' }),
  sourcing: Object.freeze({ kind: 'sourcing', matrixRow: 'A2' }),
  'fulfillment-execution': Object.freeze({ kind: 'fulfillment-execution', matrixRow: 'A3' }),
  'order-lifecycle': Object.freeze({ kind: 'order-lifecycle', matrixRow: 'A4' }),
  'returns-disposition': Object.freeze({ kind: 'returns-disposition', matrixRow: 'A5' }),
  'refund-trigger': Object.freeze({ kind: 'refund-trigger', matrixRow: 'A6' }),
  'sales-documents': Object.freeze({ kind: null, matrixRow: 'A7' }),
});

/** Narrow an untrusted string to an `AuthorityQuestion`. */
export function isAuthorityQuestion(value: unknown): value is AuthorityQuestion {
  return (
    typeof value === 'string' && (AuthorityQuestionValues as readonly string[]).includes(value)
  );
}
