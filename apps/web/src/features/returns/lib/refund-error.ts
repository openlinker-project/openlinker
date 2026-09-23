/**
 * Refund confirmation error mapping (#2382)
 *
 * Turns a failed `POST /returns/:returnId/refund` into an operator sentence —
 * the `match-error.ts` precedent, applied to `ReturnRefundBlockedError`'s own
 * closed reason union.
 *
 * **Why this is not `describeCustodyError`.** The refund confirm form sits in
 * `ReturnMoneyPanel` beside the custody controls and, before this file
 * existed, reused `describeCustodyError` for its own mutation error — which
 * has no entry for any of `ReturnRefundBlockReasonValues`, so every refund
 * refusal fell through to `RETURN_CUSTODY_ERROR_COPY.conflict`: *"This line
 * has changed since the page loaded. Reload and try again."* That sentence is
 * wrong here in a way that matters — `already-attempted` is a PERMANENT
 * business refusal (every line already carries a refund), not a stale-row
 * race, and reloading changes nothing. Sharing the describer silently
 * borrowed a vocabulary built for a different exception family
 * (`ReturnCustodyTransitionError`).
 *
 * **It reads the response body's `reason` field, never the message
 * string** — the same rule every sibling `*-error.ts` in this directory
 * follows, and for the same reason: matching on prose breaks silently the
 * first time the backend rewords a sentence, while `reason` is a closed union
 * both sides agree on.
 *
 * `ReturnRefundContendedError` (the optimistic-concurrency sibling, also a
 * 409) carries no `reason` field — a genuine stale-row race, for which
 * `RETURN_REFUND_ERROR_COPY.conflict`'s reload-and-retry wording is correct.
 * This function's `null` fallback renders exactly that.
 *
 * @module apps/web/src/features/returns/lib
 */
import { ApiError } from '../../../shared/api/api-error';
import { RETURN_REFUND_ERROR_COPY } from './return-money.copy';
import type { ReturnRefundBlockReason } from './return-money.copy';

/**
 * The refusal code, read from the 409 body.
 *
 * `null` for anything that is not one of the reasons this build recognises,
 * so a body shape this build predates degrades — see `describeRefundError`
 * for where that degrade lands, which is NOT always the same sentence.
 */
export function readRefundBlockReason(error: unknown): ReturnRefundBlockReason | null {
  if (!(error instanceof ApiError)) return null;
  const details: unknown = error.details;
  if (typeof details !== 'object' || details === null || !('reason' in details)) return null;
  const reason: unknown = (details as { reason: unknown }).reason;
  return typeof reason === 'string' && reason in RETURN_REFUND_ERROR_COPY.byReason
    ? (reason as ReturnRefundBlockReason)
    : null;
}

/**
 * True when the 409 body carries a `reason` field at all, whether or not
 * this build recognises its value.
 *
 * Splits `readRefundBlockReason`'s single `null` into the two causes that
 * `describeRefundError` must NOT answer the same way. A body with **no**
 * `reason` field is `ReturnRefundContendedError` — a genuine stale-row race,
 * for which the reload-and-retry `conflict` copy is correct. A body that
 * DOES carry a `reason`, just one this build predates (a future
 * `ReturnRefundBlockReasonValues` member), is a permanent business refusal
 * this build cannot name — and `conflict`'s "reload and try again" is false
 * for that case in the same way it was false for `already-attempted` before
 * this file existed: reloading changes nothing, and for a fiscal document
 * that cannot be withdrawn, telling the operator to retry is the wrong
 * direction to be wrong in. That case must fall to the generic sentence.
 */
function hasRefundBlockReasonField(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  const details: unknown = error.details;
  return typeof details === 'object' && details !== null && 'reason' in details;
}

/** One sentence describing why the refund confirmation did not go through. */
export function describeRefundError(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return error instanceof Error && error.message.length > 0
      ? error.message
      : RETURN_REFUND_ERROR_COPY.generic;
  }

  if (error.status === 404) {
    return RETURN_REFUND_ERROR_COPY.notFound;
  }

  if (error.status === 409) {
    const reason = readRefundBlockReason(error);
    if (reason !== null) return RETURN_REFUND_ERROR_COPY.byReason[reason];
    // No `reason` at all → the genuine contended-row race. A `reason` this
    // build does not recognise → an unnamed permanent refusal, which must
    // NOT render as a stale-row race it is not.
    return hasRefundBlockReasonField(error)
      ? RETURN_REFUND_ERROR_COPY.generic
      : RETURN_REFUND_ERROR_COPY.conflict;
  }

  if (error.status === 403) {
    return RETURN_REFUND_ERROR_COPY.forbidden;
  }

  return error.message.length > 0 ? error.message : RETURN_REFUND_ERROR_COPY.generic;
}
