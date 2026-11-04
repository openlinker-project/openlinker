/**
 * Shopify Retry Classifier
 *
 * Tells the job runner which Shopify failures are deterministic (dead on the
 * first attempt) and which are throttles to defer WITHOUT spending an attempt.
 *
 * Deferred, penalty-free:
 *   - HTTP 429 and 503;
 *   - the cost-based `THROTTLED` GraphQL error (when the client's one inline
 *     wait was not enough);
 *   - the dev-store order cap, which Shopify reports as an `orderCreate` user
 *     error "Too many attempts" rather than a 429 (L-X1). It is a ~5/min
 *     window, so a minute is the honest wait.
 *
 * Deterministic: config / not-supported / not-mapped / untracked / variant
 * exceptions, a malformed cursor (`RangeError`), any other user error (the
 * mutation wrote nothing and would be refused the same way), `ACCESS_DENIED`
 * (a missing scope, fixed in the app), and a 4xx other than 408/429. The one
 * user error that IS worth a retry is a stale compare-and-set on a stock write:
 * the level moved between read and write, and the retry re-reads it.
 *
 * @module libs/integrations/shopify/src/infrastructure/adapters
 */
import type { RetryClassifierPort, RetryDeferral } from '@openlinker/core/sync';

import { ShopifyApiError } from '../../domain/exceptions/shopify-api.error';
import { ShopifyConfigException } from '../../domain/exceptions/shopify-config.exception';
import { ShopifyGraphqlError } from '../../domain/exceptions/shopify-graphql.error';
import { ShopifyNotMappedException } from '../../domain/exceptions/shopify-not-mapped.exception';
import { ShopifyNotSupportedException } from '../../domain/exceptions/shopify-not-supported.exception';
import { ShopifyOrderNotFoundException } from '../../domain/exceptions/shopify-order-not-found.exception';
import { ShopifyReturnNotFoundException } from '../../domain/exceptions/shopify-return-not-found.exception';
import { ShopifyStockWriteRefusedException } from '../../domain/exceptions/shopify-stock-write-refused.exception';
import { ShopifyUntrackedInventoryException } from '../../domain/exceptions/shopify-untracked-inventory.exception';
import { ShopifyUserErrorsException } from '../../domain/exceptions/shopify-user-errors.exception';
import { ShopifyVariantNotFoundException } from '../../domain/exceptions/shopify-variant-not-found.exception';
import { ShopifyVariantRequiredException } from '../../domain/exceptions/shopify-variant-required.exception';

const RETRYABLE_CLIENT_ERRORS: ReadonlySet<number> = new Set([408, 429]);
const THROTTLE_DEFERRAL_SECONDS = 30;
const ORDER_CAP_DEFERRAL_SECONDS = 65;
const HTTP_THROTTLE_DEFERRAL_SECONDS = 60;
const UNAVAILABLE_DEFERRAL_SECONDS = 300;
const MAX_CAUSE_DEPTH = 5;

export class ShopifyRetryClassifierAdapter implements RetryClassifierPort {
  isNonRetryable(cause: unknown): boolean {
    if (
      cause instanceof ShopifyConfigException ||
      cause instanceof ShopifyNotSupportedException ||
      cause instanceof ShopifyNotMappedException ||
      cause instanceof ShopifyOrderNotFoundException ||
      cause instanceof ShopifyStockWriteRefusedException ||
      cause instanceof ShopifyReturnNotFoundException ||
      cause instanceof ShopifyUntrackedInventoryException ||
      cause instanceof ShopifyVariantNotFoundException ||
      cause instanceof ShopifyVariantRequiredException ||
      cause instanceof RangeError
    ) {
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
    return false;
  }

  getRetryDeferral(cause: unknown): RetryDeferral | null {
    let current: unknown = cause;
    for (let depth = 0; depth <= MAX_CAUSE_DEPTH; depth += 1) {
      const deferral = deferralFor(current);
      if (deferral !== null) {
        return deferral;
      }
      if (!(current instanceof Error)) {
        return null;
      }
      current = current.cause;
    }
    return null;
  }
}

function deferralFor(cause: unknown): RetryDeferral | null {
  if (cause instanceof ShopifyGraphqlError && cause.isThrottled()) {
    return { delaySeconds: THROTTLE_DEFERRAL_SECONDS, reason: 'Shopify query cost throttled (THROTTLED)' };
  }
  if (cause instanceof ShopifyUserErrorsException && cause.isRateLimited()) {
    return { delaySeconds: ORDER_CAP_DEFERRAL_SECONDS, reason: 'Shopify order-creation cap ("Too many attempts")' };
  }
  if (cause instanceof ShopifyApiError && cause.statusCode === 429) {
    return { delaySeconds: HTTP_THROTTLE_DEFERRAL_SECONDS, reason: 'Shopify rate-limited the request (429)' };
  }
  if (cause instanceof ShopifyApiError && cause.statusCode === 503) {
    return { delaySeconds: UNAVAILABLE_DEFERRAL_SECONDS, reason: 'Shopify unavailable (503)' };
  }
  return null;
}
