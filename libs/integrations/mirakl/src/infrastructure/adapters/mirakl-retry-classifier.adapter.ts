/**
 * Mirakl Retry Classifier Adapter
 *
 * Tells the sync runner which Mirakl failures are not worth retrying:
 *
 * - `MiraklApiException`: a deterministic 4xx (not 401/403/429), the same
 *   request fails the same way again.
 * - `MiraklAuthenticationException`: a rejected key; surfaced as
 *   `needs_reauth` by the auth-failure classifier instead.
 * - `MiraklConfigException`: raised before any request, from config that every
 *   attempt would read the same way.
 *
 * Network and rate-limit failures stay retryable, as does anything not Mirakl's.
 *
 * A 429 that outlived the client's own retries (`MiraklRateLimitException`) is
 * reported as a deferral, so the job waits out Mirakl's window without
 * spending an attempt: Mirakl counts calls per hour, and a busy hour must not
 * walk a stock or order job to `dead`. The delay is Mirakl's `Retry-After`,
 * else one minute (the documented maximum frequency of its import calls).
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters
 * @implements {RetryClassifierPort}
 */
import type { RetryClassifierPort, RetryDeferral } from '@openlinker/core/sync';
import { MiraklApiException } from '../../domain/exceptions/mirakl-api.exception';
import { MiraklAuthenticationException } from '../../domain/exceptions/mirakl-authentication.exception';
import { MiraklConfigException } from '../../domain/exceptions/mirakl-config.exception';
import { MiraklNotSupportedException } from '../../domain/exceptions/mirakl-not-supported.exception';
import { MiraklRateLimitException } from '../../domain/exceptions/mirakl-rate-limit.exception';
import { MiraklUnsupportedFieldException } from '../../domain/exceptions/mirakl-unsupported-field.exception';

export class MiraklRetryClassifierAdapter implements RetryClassifierPort {
  isNonRetryable(cause: unknown): boolean {
    return (
      cause instanceof MiraklApiException ||
      cause instanceof MiraklAuthenticationException ||
      cause instanceof MiraklConfigException ||
      cause instanceof MiraklUnsupportedFieldException ||
      cause instanceof MiraklNotSupportedException
    );
  }

  getRetryDeferral(cause: unknown): RetryDeferral | null {
    let current: unknown = cause;
    for (let depth = 0; depth <= MAX_CAUSE_DEPTH; depth += 1) {
      if (current instanceof MiraklRateLimitException) {
        return {
          delaySeconds:
            current.retryAfterMs !== undefined && current.retryAfterMs > 0
              ? Math.ceil(current.retryAfterMs / 1000)
              : RATE_LIMIT_DEFERRAL_SECONDS,
          reason: 'Mirakl rate-limited the request (429)',
        };
      }
      if (!(current instanceof Error)) {
        return null;
      }
      current = current.cause;
    }
    return null;
  }
}

/** How deep to look through wrapped causes (the runner already unwraps one). */
const MAX_CAUSE_DEPTH = 3;
/** Without `Retry-After`: Mirakl's documented maximum frequency for imports. */
const RATE_LIMIT_DEFERRAL_SECONDS = 60;
