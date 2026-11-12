/**
 * Shopify Retry Classifier
 *
 * Tells the job runner which Shopify failures are deterministic (dead on the
 * first attempt) and which are throttles to defer WITHOUT spending an attempt.
 *
 * Deferred, penalty-free:
 *   - the cost-based `THROTTLED` GraphQL error (when the client's one inline
 *     wait was not enough);
 *   - the order-creation cap, which Shopify reports as an `orderCreate` user
 *     error "Too many attempts" rather than a 429 (L-X1, ~5 per minute);
 *   - HTTP 429 and 503.
 *
 * Deterministic: a config exception, a malformed cursor (`RangeError`), any
 * user error other than the two below (the mutation wrote nothing and would
 * be refused the same way), `ACCESS_DENIED` (a scope missing on the app), a
 * refused token request, and any other 4xx except 408 / 429.
 *
 * Retried normally: a stale compare-and-set on a stock write
 * (`CHANGE_FROM_QUANTITY_STALE`, G05 - the level moved between read and
 * write, and the retry re-reads it), network errors and timeouts (G07), 5xx.
 *
 * Exceptions owned by the capability adapters join this list with their adapters.
 *
 * @module libs/integrations/shopify/src/infrastructure/adapters
 */
import type { RetryClassifierPort, RetryDeferral } from '@openlinker/core/sync';

import { ShopifyApiError } from '../../domain/exceptions/shopify-api.error';
import { ShopifyConfigException } from '../../domain/exceptions/shopify-config.exception';
import { ShopifyGraphqlError } from '../../domain/exceptions/shopify-graphql.error';
import { ShopifyUserErrorsException } from '../../domain/exceptions/shopify-user-errors.exception';

const RETRYABLE_CLIENT_ERRORS: ReadonlySet<number> = new Set([408, 429]);
const THROTTLE_DEFERRAL_SECONDS = 30;
const ORDER_CAP_DEFERRAL_SECONDS = 65;
const HTTP_THROTTLE_DEFERRAL_SECONDS = 60;
const UNAVAILABLE_DEFERRAL_SECONDS = 300;
const MAX_CAUSE_DEPTH = 5;

/**
 * Both questions walk the same `cause` chain: the runner unwraps one
 * `SyncJobExecutionError` itself, but a capability adapter may wrap a Shopify
 * error once more, and a classifier that looked deeper for one answer than
 * for the other would defer a failure it could not call terminal (or the
 * reverse). The first Shopify error found decides; anything else is walked past.
 *
 * Only Shopify's own errors are looked for down the chain. The registry asks
 * EVERY classifier about EVERY job's failure, whatever its platform, so a
 * generic `RangeError` is answered only when it is the failure itself (as
 * before, and as the Shoper classifier does): walking for it would make
 * another plugin's job dead because something deep in its chain was a
 * `RangeError`.
 */
export class ShopifyRetryClassifierAdapter implements RetryClassifierPort {
  isNonRetryable(cause: unknown): boolean {
    if (cause instanceof RangeError) {
      return true;
    }
    return firstInCauseChain(cause, terminalityOf) ?? false;
  }

  getRetryDeferral(cause: unknown): RetryDeferral | null {
    return firstInCauseChain(cause, deferralFor);
  }
}

function firstInCauseChain<T>(cause: unknown, pick: (error: unknown) => T | null): T | null {
  let current: unknown = cause;
  for (let depth = 0; depth <= MAX_CAUSE_DEPTH; depth += 1) {
    const answer = pick(current);
    if (answer !== null) {
      return answer;
    }
    if (!(current instanceof Error)) {
      return null;
    }
    current = current.cause;
  }
  return null;
}

/** True terminal, false retryable, null when the error is not a Shopify error. */
function terminalityOf(cause: unknown): boolean | null {
  if (cause instanceof ShopifyConfigException) {
    return true;
  }
  if (cause instanceof ShopifyUserErrorsException) {
    return !cause.isRateLimited() && !cause.isStaleCompareAndSet();
  }
  if (cause instanceof ShopifyGraphqlError) {
    return cause.isAccessDenied();
  }
  if (cause instanceof ShopifyApiError) {
    return (
      cause.statusCode >= 400 &&
      cause.statusCode < 500 &&
      !RETRYABLE_CLIENT_ERRORS.has(cause.statusCode)
    );
  }
  return null;
}

function deferralFor(cause: unknown): RetryDeferral | null {
  if (cause instanceof ShopifyGraphqlError && cause.isThrottled()) {
    return { delaySeconds: THROTTLE_DEFERRAL_SECONDS, reason: 'Shopify query cost throttled (THROTTLED)' };
  }
  if (cause instanceof ShopifyUserErrorsException && cause.isRateLimited()) {
    return {
      delaySeconds: ORDER_CAP_DEFERRAL_SECONDS,
      reason: 'Shopify order-creation cap ("Too many attempts")',
    };
  }
  if (cause instanceof ShopifyApiError && cause.statusCode === 429) {
    return { delaySeconds: HTTP_THROTTLE_DEFERRAL_SECONDS, reason: 'Shopify rate-limited the request (429)' };
  }
  if (cause instanceof ShopifyApiError && cause.statusCode === 503) {
    return { delaySeconds: UNAVAILABLE_DEFERRAL_SECONDS, reason: 'Shopify unavailable (503)' };
  }
  return null;
}
