/**
 * Erli Retry Classifier — unit tests (#984)
 *
 * @module libs/integrations/erli/src/infrastructure/adapters/__tests__
 */
import { ErliApiException } from '../../../domain/exceptions/erli-api.exception';
import { ErliAuthenticationException } from '../../../domain/exceptions/erli-authentication.exception';
import { ErliConfigException } from '../../../domain/exceptions/erli-config.exception';
import { ErliNetworkException } from '../../../domain/exceptions/erli-network.exception';
import { ErliRateLimitException } from '../../../domain/exceptions/erli-rate-limit.exception';
import { ErliRetryClassifierAdapter } from '../erli-retry-classifier.adapter';

describe('ErliRetryClassifierAdapter', () => {
  const classifier = new ErliRetryClassifierAdapter();

  it('should mark a deterministic 4xx ErliApiException non-retryable', () => {
    expect(classifier.isNonRetryable(new ErliApiException('bad', 422))).toBe(true);
  });

  it('should mark an authentication error non-retryable', () => {
    expect(classifier.isNonRetryable(new ErliAuthenticationException('unauth', 401))).toBe(true);
  });

  it('should mark a config/validation error non-retryable (deterministic, never succeeds on retry)', () => {
    expect(classifier.isNonRetryable(new ErliConfigException('hostile product id'))).toBe(true);
  });

  it('should leave network errors retryable', () => {
    expect(classifier.isNonRetryable(new ErliNetworkException('boom'))).toBe(false);
  });

  it('should leave rate-limit errors retryable', () => {
    expect(classifier.isNonRetryable(new ErliRateLimitException('429'))).toBe(false);
  });

  it('should leave an unrecognized error retryable (default)', () => {
    expect(classifier.isNonRetryable(new Error('?'))).toBe(false);
  });
});
