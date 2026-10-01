import { ShoperApiError } from '../../../domain/exceptions/shoper-api.error';
import { ShoperConfigException } from '../../../domain/exceptions/shoper-config.exception';
import { ShoperNetworkError } from '../../../domain/exceptions/shoper-network.error';
import { ShoperNotMappedException } from '../../../domain/exceptions/shoper-not-mapped.exception';
import { ShoperNotSupportedException } from '../../../domain/exceptions/shoper-not-supported.exception';
import { ShoperRetryClassifierAdapter } from '../shoper-retry-classifier.adapter';

describe('ShoperRetryClassifierAdapter', () => {
  const classifier = new ShoperRetryClassifierAdapter();

  it.each([
    ['a config exception', new ShoperConfigException('c', 'no token')],
    ['a not-supported exception', new ShoperNotSupportedException('createProduct')],
    ['a not-mapped exception', new ShoperNotMappedException('p', 'c')],
    ['a RangeError from the adapter’s own bounds', new RangeError('window')],
  ])('should treat %s as terminal: re-running the job fails identically', (_label, cause) => {
    expect(classifier.isNonRetryable(cause)).toBe(true);
  });

  it.each([400, 401, 403, 404, 410, 422])('should treat HTTP %i as terminal', (status) => {
    expect(classifier.isNonRetryable(new ShoperApiError(status))).toBe(true);
  });

  it.each([408, 429, 500, 502, 503, 504])('should keep HTTP %i retryable', (status) => {
    expect(classifier.isNonRetryable(new ShoperApiError(status))).toBe(false);
  });

  it('should keep a network failure retryable', () => {
    expect(classifier.isNonRetryable(new ShoperNetworkError('ECONNRESET'))).toBe(false);
    expect(classifier.isNonRetryable(new ShoperNetworkError('slow', true))).toBe(false);
  });

  it('should leave an unrelated throwable to the default (retryable)', () => {
    expect(classifier.isNonRetryable(new Error('boom'))).toBe(false);
    expect(classifier.isNonRetryable('boom')).toBe(false);
    expect(classifier.isNonRetryable(undefined)).toBe(false);
  });
});
