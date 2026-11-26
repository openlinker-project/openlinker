/**
 * Mirakl Retry and Auth-Failure Classifiers: unit tests
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters
 */
import { MiraklApiException } from '../../../domain/exceptions/mirakl-api.exception';
import { MiraklAuthenticationException } from '../../../domain/exceptions/mirakl-authentication.exception';
import { MiraklConfigException } from '../../../domain/exceptions/mirakl-config.exception';
import { MiraklNetworkException } from '../../../domain/exceptions/mirakl-network.exception';
import { MiraklRateLimitException } from '../../../domain/exceptions/mirakl-rate-limit.exception';
import { MiraklAuthFailureClassifierAdapter } from '../mirakl-auth-failure-classifier.adapter';
import { MiraklRetryClassifierAdapter } from '../mirakl-retry-classifier.adapter';

describe('MiraklRetryClassifierAdapter', () => {
  const classifier = new MiraklRetryClassifierAdapter();

  it.each([
    new MiraklApiException('400', 400),
    new MiraklAuthenticationException('401', 401),
    new MiraklConfigException('bad config'),
  ])('should mark %p as non-retryable', (error) => {
    expect(classifier.isNonRetryable(error)).toBe(true);
  });

  it.each([new MiraklNetworkException('down'), new MiraklRateLimitException('429'), new Error('other')])(
    'should leave %p retryable',
    (error) => {
      expect(classifier.isNonRetryable(error)).toBe(false);
    },
  );

  it('should defer a 429 for the Retry-After Mirakl sent, without spending an attempt', () => {
    expect(classifier.getRetryDeferral(new MiraklRateLimitException('429', 22_000))).toEqual({
      delaySeconds: 22,
      reason: expect.stringContaining('429'),
    });
  });

  it('should defer a 429 without Retry-After by one minute', () => {
    expect(classifier.getRetryDeferral(new MiraklRateLimitException('429'))?.delaySeconds).toBe(60);
  });

  it('should find a 429 wrapped as the cause of another error', () => {
    const wrapped = new Error('job failed', { cause: new MiraklRateLimitException('429', 5_000) });

    expect(classifier.getRetryDeferral(wrapped)?.delaySeconds).toBe(5);
  });

  it.each([new MiraklApiException('400', 400), new MiraklNetworkException('down'), 'text'])(
    'should not defer %p',
    (error) => {
      expect(classifier.getRetryDeferral(error)).toBeNull();
    },
  );
});

describe('MiraklAuthFailureClassifierAdapter', () => {
  const classifier = new MiraklAuthFailureClassifierAdapter();

  it('should treat an authentication exception as a rejected credential', () => {
    expect(classifier.isCredentialRejected(new MiraklAuthenticationException('401', 401))).toBe(true);
  });

  it('should not treat other failures as a rejected credential', () => {
    expect(classifier.isCredentialRejected(new MiraklApiException('404', 404))).toBe(false);
    expect(classifier.isCredentialRejected(new MiraklNetworkException('down'))).toBe(false);
  });
});
