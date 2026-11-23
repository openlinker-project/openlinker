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
 * @module libs/integrations/mirakl/src/infrastructure/adapters
 * @implements {RetryClassifierPort}
 */
import type { RetryClassifierPort } from '@openlinker/core/sync';
import { MiraklApiException } from '../../domain/exceptions/mirakl-api.exception';
import { MiraklAuthenticationException } from '../../domain/exceptions/mirakl-authentication.exception';
import { MiraklConfigException } from '../../domain/exceptions/mirakl-config.exception';

export class MiraklRetryClassifierAdapter implements RetryClassifierPort {
  isNonRetryable(cause: unknown): boolean {
    return (
      cause instanceof MiraklApiException ||
      cause instanceof MiraklAuthenticationException ||
      cause instanceof MiraklConfigException
    );
  }
}
