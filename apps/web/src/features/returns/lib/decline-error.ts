/**
 * Decline error mapping
 *
 * Turns a failed decline into one operator sentence, chosen by the error's
 * stable code (#3863) through `describeApiError` - never by status or by the
 * message, which is prose the backend is free to reword.
 *
 * The decline refusals are the exception, and deliberately so: their message
 * is the ADAPTER's own explanation of why the channel cannot be asked (and,
 * for a bad rejection code, the list of codes it does accept). That is
 * information OpenLinker cannot reconstruct, so it follows the translated
 * sentence verbatim, as a provider's words do.
 *
 * @module apps/web/src/features/returns/lib
 */
import { ApiError } from '../../../shared/api/api-error';
import { describeApiError } from '../../../shared/api/describe-api-error';

const ADAPTER_WORDED_CODES = new Set(['RETURN_DECLINE_UNSUPPORTED', 'RETURN_DECLINE_INVALID']);

/**
 * The blocked downstream trigger of an unmatched return (`params.trigger`).
 *
 * Returns `null` for anything that is not a non-empty string, so a body shape
 * this build predates degrades to the plain sentence rather than rendering
 * `undefined` or `[object Object]` at the operator.
 */
export function readBlockedTrigger(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const trigger = error.params.trigger;
  return typeof trigger === 'string' && trigger.length > 0 ? trigger : null;
}

export function describeDeclineError(error: unknown): string {
  const sentence = describeApiError(error);
  if (
    error instanceof ApiError &&
    error.code !== undefined &&
    ADAPTER_WORDED_CODES.has(error.code) &&
    // eslint-disable-next-line no-restricted-syntax -- the adapter explains why the channel cannot be asked; OpenLinker cannot reconstruct that, so it follows the translated sentence (#3863)
    error.message.length > 0
  ) {
    // eslint-disable-next-line no-restricted-syntax -- see the condition above: the adapter's own explanation
    return `${sentence} ${error.message}`;
  }
  return sentence;
}
