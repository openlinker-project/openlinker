/**
 * Decline error mapping
 *
 * Turns a failed decline into one operator sentence.
 *
 * **It reads the status code and the error body's own fields — never the
 * message string.** `ReturnsExceptionFilter`'s docblock says exactly that about
 * `ReturnNotAttributedError.trigger`: any structured rendering reads the field,
 * because the field and the sentence would otherwise drift the first time the
 * backend reworded the sentence. The 409 body carries `trigger`; this reads it
 * there.
 *
 * The 400 is the exception, and deliberately so: its message is the ADAPTER's
 * own explanation of why the channel cannot be asked (and, for a bad rejection
 * code, the list of codes it does accept). That is information OpenLinker
 * cannot reconstruct, so it is passed through rather than replaced.
 *
 * @module apps/web/src/features/returns/lib
 */
import { ApiError } from '../../../shared/api/api-error';
import { RETURN_DECLINE_ERROR_COPY } from './return-detail.copy';

/**
 * The blocked downstream trigger, read from the 409 body.
 *
 * Returns `null` for anything that is not a non-empty string, so a body shape
 * this build predates degrades to the plain conflict sentence rather than
 * rendering `undefined` or `[object Object]` at the operator.
 */
export function readBlockedTrigger(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const details: unknown = error.details;
  if (typeof details !== 'object' || details === null || !('trigger' in details)) return null;
  const trigger: unknown = (details as { trigger: unknown }).trigger;
  return typeof trigger === 'string' && trigger.length > 0 ? trigger : null;
}

/** One sentence describing why the decline did not go through. */
export function describeDeclineError(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return error instanceof Error && error.message.length > 0
      ? error.message
      : RETURN_DECLINE_ERROR_COPY.generic;
  }

  if (error.status === 404) {
    return RETURN_DECLINE_ERROR_COPY.notFound;
  }

  if (error.status === 409) {
    const trigger = readBlockedTrigger(error);
    return trigger === null
      ? RETURN_DECLINE_ERROR_COPY.conflictPrefix
      : `${RETURN_DECLINE_ERROR_COPY.conflictPrefix} ${RETURN_DECLINE_ERROR_COPY.conflictTriggerPrefix} ${trigger}`;
  }

  if (error.status === 400) {
    // The adapter's own words — see the module docblock.
    return error.message.length > 0
      ? `${RETURN_DECLINE_ERROR_COPY.unsupported} ${error.message}`
      : RETURN_DECLINE_ERROR_COPY.unsupported;
  }

  return error.message.length > 0 ? error.message : RETURN_DECLINE_ERROR_COPY.generic;
}
