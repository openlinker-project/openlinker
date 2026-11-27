/**
 * Routing retry error sentence (#3557, i18n #3875)
 *
 * One sentence for a failed "Retry routing", mapped from the HTTP status and
 * the 409's `error` code - the `{ statusCode, error, message }` shape the
 * `/orders` controller uses for every conflict - never from the server
 * message. Read from `fulfillment.routingDecisionRetryError` at call time.
 *
 * @module apps/web/src/features/fulfillment/lib
 */
import { ApiError } from '../../../shared/api/api-error';
import { getMessages } from '../../../shared/i18n';

function readCode(error: ApiError): string | null {
  const details: unknown = error.details;
  if (typeof details !== 'object' || details === null || !('error' in details)) return null;
  const code: unknown = (details as { error: unknown }).error;
  return typeof code === 'string' ? code : null;
}

/** One sentence for a failed retry, mapped from status and `code`, never the server message. */
export function describeRetryRoutingError(error: unknown): string {
  const copy = getMessages('fulfillment').routingDecisionRetryError;
  if (error instanceof ApiError) {
    if (error.status === 404) return copy.notFound;
    if (error.status === 409) {
      const code = readCode(error);
      const byCode = copy.byCode as Readonly<Record<string, string>>;
      const known =
        code !== null && Object.prototype.hasOwnProperty.call(byCode, code) ? byCode[code] : undefined;
      return known ?? copy.conflict;
    }
    if (error.status === 503) return copy.unavailable;
  }
  return copy.fallback;
}
