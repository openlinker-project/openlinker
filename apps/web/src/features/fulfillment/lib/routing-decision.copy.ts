/**
 * Routing decision copy (#3557)
 *
 * Operator wording for the three states. It says OpenLinker is WAITING for the
 * router's own answer - not that OpenLinker is broken - and never offers a way
 * to override it.
 *
 * @module apps/web/src/features/fulfillment/lib
 */
import { ApiError } from '../../../shared/api/api-error';

export const ROUTING_DECISION_COPY = {
  stuck: {
    title: 'Routing is stuck',
    body: 'OpenLinker asked where to pack this order and has not got a final answer yet. It is waiting for that answer rather than guessing, so it cannot ship the order twice. After the time limit it stops waiting and chooses again on its own.',
  },
  resolved: {
    title: 'OpenLinker stopped waiting',
    // The reaper starts routing again only when it can hand off to a route job.
    // When it could not, it holds the order as `routing-failed` instead, so the
    // body must not claim a re-route that never started (#3557 review).
    body: 'The answer did not arrive in time, so OpenLinker closed the earlier attempt and is routing this order again. Nothing was packed or sent in the meantime.',
    bodyNotRestarted:
      'The answer did not arrive in time, so OpenLinker closed the earlier attempt, but could not start routing again. It tries again on its own later. Nothing was packed or sent in the meantime.',
  },
  healthy: {
    title: 'Routed automatically',
  },
  retry: {
    action: 'Retry routing',
    pending: 'Retrying…',
    started: 'Routing was started again. The order updates when it finishes.',
  },
  readFailed: 'Could not load the routing status of this order.',
} as const;

/**
 * Keyed by the 409's `error` code, the `{ statusCode, error, message }` shape the
 * `/orders` controller uses for every conflict (`ORDER_ALREADY_ON_HOLD`, #2341).
 */
const RETRY_ERROR_BY_CODE: Record<string, string> = {
  ROUTING_RETRY_NOT_HELD: 'This order is not waiting on routing any more, so there is nothing to retry.',
  ROUTING_RETRY_NOT_RETRYABLE:
    'Routing cannot be retried for this order yet. Its current wait ends on its own or needs a change to the order.',
  ROUTING_RETRY_NO_ROUTER: 'No connection is set to decide where orders are packed, so routing cannot run.',
};

function readCode(error: ApiError): string | null {
  const details: unknown = error.details;
  if (typeof details !== 'object' || details === null || !('error' in details)) return null;
  const code: unknown = (details as { error: unknown }).error;
  return typeof code === 'string' ? code : null;
}

/** One sentence for a failed retry, mapped from status and `code`, never the server message. */
export function describeRetryRoutingError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404) return 'This order no longer exists.';
    if (error.status === 409) {
      const code = readCode(error);
      return (
        (code !== null ? RETRY_ERROR_BY_CODE[code] : undefined) ??
        'Routing cannot be retried for this order right now.'
      );
    }
    if (error.status === 503) return 'Could not start routing. Try again in a moment.';
  }
  return 'Could not retry routing. Try again in a moment.';
}
