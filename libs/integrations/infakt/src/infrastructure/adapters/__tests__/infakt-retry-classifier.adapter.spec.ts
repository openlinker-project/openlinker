/**
 * Infakt Retry Classifier — Unit Specs
 *
 * Pins which Infakt HTTP statuses the worker runner must treat as terminal
 * (non-retryable) vs transient (retryable), and confirms the classifier
 * abstains (returns `false`) for anything that is not an `InfaktApiError` —
 * the OR-aggregation contract every classifier in the registry must honour.
 *
 * @module libs/integrations/infakt/src/infrastructure/adapters/__tests__
 */
import { InfaktRetryClassifierAdapter } from '../infakt-retry-classifier.adapter';
import { InfaktApiError } from '../../../domain/exceptions/infakt-api.error';

describe('InfaktRetryClassifierAdapter', () => {
  const classifier = new InfaktRetryClassifierAdapter();

  describe('non-retryable (terminal / in-doubt) errors', () => {
    it('should be non-retryable for a 400 InfaktApiError (rejected)', () => {
      expect(classifier.isNonRetryable(new InfaktApiError('bad request', 400, {}))).toBe(true);
    });

    it('should be non-retryable for a 422 InfaktApiError (rejected)', () => {
      expect(classifier.isNonRetryable(new InfaktApiError('unprocessable', 422, {}))).toBe(true);
    });

    it('should be non-retryable for a 404 InfaktApiError (rejected)', () => {
      expect(classifier.isNonRetryable(new InfaktApiError('not found', 404, {}))).toBe(true);
    });

    it('should be non-retryable for a 500 InfaktApiError (in-doubt)', () => {
      expect(classifier.isNonRetryable(new InfaktApiError('server error', 500, {}))).toBe(true);
    });

    it('should be non-retryable for a 503 InfaktApiError (in-doubt)', () => {
      expect(classifier.isNonRetryable(new InfaktApiError('unavailable', 503, {}))).toBe(true);
    });
  });

  describe('retryable (transient) errors', () => {
    it('should be retryable for a 429 rate-limit InfaktApiError', () => {
      expect(classifier.isNonRetryable(new InfaktApiError('rate limited', 429, {}))).toBe(false);
    });
  });

  describe('abstention for foreign / unrecognized errors', () => {
    it('should abstain (false) for a plain Error', () => {
      expect(classifier.isNonRetryable(new Error('network failure'))).toBe(false);
    });

    it('should abstain (false) for a non-Error throwable', () => {
      expect(classifier.isNonRetryable('not even an error')).toBe(false);
    });

    it('should abstain (false) for null/undefined', () => {
      expect(classifier.isNonRetryable(null)).toBe(false);
      expect(classifier.isNonRetryable(undefined)).toBe(false);
    });
  });
});
