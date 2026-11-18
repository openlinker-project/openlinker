/**
 * Amazon retry and auth-failure classifier tests (#3741 foundation)
 *
 * @module libs/integrations/amazon/src/infrastructure/adapters/__tests__
 */
import { AmazonApiError } from '../../../domain/exceptions/amazon-api.error';
import { AmazonAuthenticationError } from '../../../domain/exceptions/amazon-authentication.error';
import { AmazonConfigException } from '../../../domain/exceptions/amazon-config.exception';
import { AmazonNetworkError } from '../../../domain/exceptions/amazon-network.error';
import { AmazonAuthFailureClassifierAdapter } from '../amazon-auth-failure-classifier.adapter';
import { AmazonRetryClassifierAdapter } from '../amazon-retry-classifier.adapter';

const api = (status: number, code?: string): AmazonApiError => new AmazonApiError(status, code, undefined, 'req');

describe('AmazonRetryClassifierAdapter', () => {
  const classifier = new AmazonRetryClassifierAdapter();

  it('should make config, credential and deterministic 4xx failures terminal', () => {
    expect(classifier.isNonRetryable(new AmazonConfigException('c1', 'no marketplace'))).toBe(true);
    expect(classifier.isNonRetryable(new AmazonAuthenticationError('invalid_grant'))).toBe(true);
    for (const status of [400, 403, 404, 413, 415]) {
      expect(classifier.isNonRetryable(api(status))).toBe(true);
    }
  });

  it('should retry network failures, 408, 429 and 5xx', () => {
    expect(classifier.isNonRetryable(new AmazonNetworkError('down'))).toBe(false);
    for (const status of [408, 429, 500, 503]) {
      expect(classifier.isNonRetryable(api(status))).toBe(false);
    }
  });

  it('should not claim errors from other plugins', () => {
    expect(classifier.isNonRetryable(new Error('boom'))).toBe(false);
    expect(classifier.getRetryDeferral(new Error('boom'))).toBeNull();
  });

  it('should defer a throttle long enough for the slowest quota, and a 503', () => {
    expect(classifier.getRetryDeferral(api(429, 'QuotaExceeded'))).toEqual({
      delaySeconds: 240,
      reason: 'Amazon throttled the request (429)',
    });
    expect(classifier.getRetryDeferral(api(503))?.delaySeconds).toBe(300);
    expect(classifier.getRetryDeferral(api(500))).toBeNull();
  });

  it('should find a throttle wrapped in another error', () => {
    const wrapped = new Error('order sync failed', { cause: api(429) });
    expect(classifier.getRetryDeferral(wrapped)?.delaySeconds).toBe(240);
  });
});

describe('AmazonAuthFailureClassifierAdapter', () => {
  const classifier = new AmazonAuthFailureClassifierAdapter();

  it('should flag only an LWA refusal as rejected credentials', () => {
    expect(classifier.isCredentialRejected(new AmazonAuthenticationError('invalid_grant'))).toBe(true);
    expect(classifier.isCredentialRejected(api(403, 'Unauthorized'))).toBe(false);
    expect(classifier.isCredentialRejected(api(401))).toBe(false);
  });
});
