/**
 * Amazon Retry Classifier
 *
 * Tells the worker runner which Amazon failures are DETERMINISTIC, so the job
 * goes terminal instead of burning the retry ladder (ADR-007), and which are
 * throttling to wait out without spending an attempt (#2613).
 *
 * Non-retryable:
 *   - `AmazonConfigException` - unusable config or credentials; only an
 *     operator edit changes that.
 *   - `AmazonAuthenticationError` - Login with Amazon refused the credentials;
 *     also surfaced as `needs_reauth` by the auth-failure classifier.
 *   - `AmazonNotSupportedException` - a request this integration does not
 *     carry out (an FBA listing's stock, a field it does not write).
 *   - `AmazonApiError` 4xx other than 408 and 429 - Amazon understood the
 *     request and refused it (`400 InvalidInput`, `403 Unauthorized` for a
 *     missing role, `404 NotFound`, `413`, `415`).
 *   - A product type schema the adapter refuses to read (`SchemaLinkInvalid`,
 *     `SchemaTooLarge`): Amazon names the same link and file on every call, so
 *     a retry meets the same refusal and only holds a bulk batch open.
 *
 * Retryable (the default): `AmazonNetworkError`, `408`, `429`, every `5xx`.
 *
 * Deferred penalty-free (`getRetryDeferral`):
 *   - `429 QuotaExceeded` - SP-API quotas are per operation and per (seller,
 *     app), and some operations restore very slowly (`searchOrders` allows
 *     about one call per three minutes, #3741), so the wait is long enough for
 *     the slowest bucket the plugin touches. `x-amzn-RateLimit-Limit` is not
 *     read: Amazon sends it only "when available" and warns not to rely on it.
 *   - `503` - Amazon unavailable.
 *
 * Looks through `Error.cause` (bounded depth), so a capability adapter that
 * wraps the transport failure keeps its deferral.
 *
 * @module libs/integrations/amazon/src/infrastructure/adapters
 * @implements {RetryClassifierPort}
 */
import type { RetryClassifierPort, RetryDeferral } from '@openlinker/core/sync';

import { AmazonApiError } from '../../domain/exceptions/amazon-api.error';
import { AmazonAuthenticationError } from '../../domain/exceptions/amazon-authentication.error';
import { AmazonConfigException } from '../../domain/exceptions/amazon-config.exception';
import { AmazonNotSupportedException } from '../../domain/exceptions/amazon-not-supported.exception';

const RETRYABLE_CLIENT_ERRORS: ReadonlySet<number> = new Set([408, 429]);

/** Codes the plugin raises itself for a schema it will not read; deterministic despite their 502. */
const DETERMINISTIC_SCHEMA_ERRORS: ReadonlySet<string> = new Set(['SchemaLinkInvalid', 'SchemaTooLarge']);

/** Longer than `searchOrders`' ~180 s restore interval, the slowest quota in scope. */
const THROTTLE_DEFERRAL_SECONDS = 240;

const UNAVAILABLE_DEFERRAL_SECONDS = 300;

const MAX_CAUSE_DEPTH = 5;

export class AmazonRetryClassifierAdapter implements RetryClassifierPort {
  isNonRetryable(cause: unknown): boolean {
    if (
      cause instanceof AmazonConfigException ||
      cause instanceof AmazonAuthenticationError ||
      cause instanceof AmazonNotSupportedException
    ) {
      return true;
    }
    const apiError = findAmazonApiError(cause);
    if (apiError?.errorCode !== undefined && DETERMINISTIC_SCHEMA_ERRORS.has(apiError.errorCode)) {
      return true;
    }
    if (cause instanceof AmazonApiError) {
      return (
        cause.statusCode >= 400 && cause.statusCode < 500 && !RETRYABLE_CLIENT_ERRORS.has(cause.statusCode)
      );
    }
    return false;
  }

  getRetryDeferral(cause: unknown): RetryDeferral | null {
    const apiError = findAmazonApiError(cause);
    if (apiError === null) {
      return null;
    }
    if (apiError.statusCode === 429) {
      return { delaySeconds: THROTTLE_DEFERRAL_SECONDS, reason: 'Amazon throttled the request (429)' };
    }
    if (apiError.statusCode === 503) {
      return { delaySeconds: UNAVAILABLE_DEFERRAL_SECONDS, reason: 'Amazon unavailable (503)' };
    }
    return null;
  }
}

function findAmazonApiError(cause: unknown): AmazonApiError | null {
  let current: unknown = cause;
  for (let depth = 0; depth <= MAX_CAUSE_DEPTH && current !== undefined && current !== null; depth += 1) {
    if (current instanceof AmazonApiError) {
      return current;
    }
    current = current instanceof Error ? current.cause : undefined;
  }
  return null;
}
