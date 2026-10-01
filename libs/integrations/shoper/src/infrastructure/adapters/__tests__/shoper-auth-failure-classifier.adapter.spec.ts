import { ShoperApiError } from '../../../domain/exceptions/shoper-api.error';
import { ShoperNetworkError } from '../../../domain/exceptions/shoper-network.error';
import { ShoperAuthFailureClassifierAdapter } from '../shoper-auth-failure-classifier.adapter';

describe('ShoperAuthFailureClassifierAdapter', () => {
  const classifier = new ShoperAuthFailureClassifierAdapter();

  it.each([401, 403])('should flag HTTP %i as a rejected credential', (status) => {
    expect(classifier.isCredentialRejected(new ShoperApiError(status))).toBe(true);
  });

  it.each([404, 429, 500, 503])('should not flag HTTP %i', (status) => {
    expect(classifier.isCredentialRejected(new ShoperApiError(status))).toBe(false);
  });

  it('should not flag a network error or an unrelated throwable', () => {
    expect(classifier.isCredentialRejected(new ShoperNetworkError('down'))).toBe(false);
    expect(classifier.isCredentialRejected(new Error('boom'))).toBe(false);
    expect(classifier.isCredentialRejected('401')).toBe(false);
  });
});
