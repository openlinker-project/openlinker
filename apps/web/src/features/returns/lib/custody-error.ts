/**
 * Custody write error mapping
 *
 * One place that turns a refused receive / dispose / write-off into one
 * operator sentence, shared by both inline forms (#2380).
 *
 * **It reads the 409 body's `reason` field, never the message string** — the
 * same rule `decline-error.ts` follows for `trigger`, and the reason
 * `ReturnCustodyTransitionError` carries a CLOSED union in the first place:
 * matching on prose would break silently the first time the backend reworded a
 * sentence.
 *
 * Shared rather than duplicated per form because the two forms can refuse for
 * the same reason — `illegal-transition` reaches both — and two copies would
 * eventually phrase one refusal two ways.
 *
 * @module apps/web/src/features/returns/lib
 */
import { ApiError } from '../../../shared/api/api-error';
import { RETURN_CUSTODY_ERROR_COPY } from './return-custody.copy';

/**
 * The refusal code, read from the 409 body.
 *
 * `null` for anything that is not a non-empty string, so a body shape this
 * build predates degrades to the generic conflict sentence rather than
 * rendering `undefined` at the operator.
 */
export function readCustodyRefusalReason(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const details: unknown = error.details;
  if (typeof details !== 'object' || details === null || !('reason' in details)) return null;
  const reason: unknown = (details as { reason: unknown }).reason;
  return typeof reason === 'string' && reason.length > 0 ? reason : null;
}

/** One sentence describing why the custody write did not go through. */
export function describeCustodyError(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return error instanceof Error && error.message.length > 0
      ? error.message
      : RETURN_CUSTODY_ERROR_COPY.generic;
  }

  if (error.status === 404) {
    return RETURN_CUSTODY_ERROR_COPY.notFound;
  }

  if (error.status === 409) {
    const reason = readCustodyRefusalReason(error);
    // An unrecognised reason falls through to the generic conflict sentence
    // rather than rendering the raw code: a code is not a sentence, and this
    // build genuinely does not know what a future one means.
    return reason !== null && reason in RETURN_CUSTODY_ERROR_COPY.byReason
      ? RETURN_CUSTODY_ERROR_COPY.byReason[reason]
      : RETURN_CUSTODY_ERROR_COPY.conflict;
  }

  if (error.status === 403) {
    return RETURN_CUSTODY_ERROR_COPY.forbidden;
  }

  return error.message.length > 0 ? error.message : RETURN_CUSTODY_ERROR_COPY.generic;
}
