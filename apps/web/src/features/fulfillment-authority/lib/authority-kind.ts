/**
 * Authority Kind Vocabulary (frontend mirror)
 *
 * The six independently assignable authorities of ADR-052's matrix (rows
 * A1-A6), as codes. Nothing here is rendered verbatim — operator copy for the
 * seven who-decides QUESTIONS lives in `who-decides.copy.ts`, and the question
 * list is a different, longer list on purpose (see below).
 *
 * ## Why this is a hand-maintained copy
 *
 * The authority is
 * `libs/core/src/fulfillment-authority/domain/types/authority-kind.types.ts`.
 * The browser bundle cannot depend on `@openlinker/core` (#591), so this is a
 * copy — and a copy drifts silently in both directions.
 * `scripts/check-authority-kind-mirror.mjs` (in `pnpm check:invariants`) is the
 * enforcement, not this comment. That script reads the array below
 * **textually**: one member per line, no computed keys, no spread.
 *
 * ## Six kinds, seven questions — and that is not a mistake
 *
 * `AuthorityQuestionValues` (mirrored in `who-decides.types.ts`) has
 * SEVEN members. A7 — "who issues invoices and receipts?" — is a question an
 * operator asks and a row this page must render, but it is NOT an authority
 * kind, because `sales-documents` already owns its answer (ADR-041). It
 * therefore resolves to a LINK rather than a mirrored answer. Do not "fix" the
 * count here to seven; core's own file says the same thing in the same terms.
 *
 * @module apps/web/src/features/fulfillment-authority/lib
 * @see docs/architecture/adrs/052-independently-assignable-fulfillment-authorities.md
 */

/**
 * The six authorities, in core's order.
 *
 * One member per line — the mirror script parses this array as text after
 * stripping comments, so a computed value is unreadable to it and to the next
 * human.
 */
export const AuthorityKindValues = [
  /** A1 — how much stock we can promise. */
  'availability',
  /** A2 — where an order ships from. */
  'sourcing',
  /** A3 — who picks and ships. */
  'fulfillment-execution',
  /** A4 — what state an order is in. */
  'order-lifecycle',
  /** A5 — what happens to returned goods. */
  'returns-disposition',
  /** A6 — who issues refunds. Never assignable (ADR-056). */
  'refund-trigger',
] as const;

export type AuthorityKind = (typeof AuthorityKindValues)[number];

/** Narrow an untrusted string — a persisted value, a query param, a wire field. */
export function isAuthorityKind(value: unknown): value is AuthorityKind {
  return typeof value === 'string' && (AuthorityKindValues as readonly string[]).includes(value);
}
