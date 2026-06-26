/**
 * KSeF Retry Classifier — Unit Specs
 *
 * Pins which KSeF exceptions the worker runner must treat as terminal
 * (non-retryable) vs transient (retryable). Without this classifier the registry
 * defaults unknown errors to retryable, so a terminal failure would be retried
 * until the job dies.
 *
 * @module libs/integrations/ksef/src/infrastructure/adapters
 */
import { KsefRetryClassifierAdapter } from '../ksef-retry-classifier.adapter';
import { KsefApiException } from '../../../domain/exceptions/ksef-api.exception';
import { KsefNetworkException } from '../../../domain/exceptions/ksef-network.exception';
import { KsefSessionException } from '../../../domain/exceptions/ksef-session.exception';
import { KsefUnsupportedDocumentTypeException } from '../../../domain/exceptions/ksef-unsupported-document-type.exception';
import { UnmappedTaxRateException } from '../../../domain/exceptions/fa3-builder.exception';
import { Fa3XsdValidationException } from '../../../domain/exceptions/fa3-validation.exception';

describe('KsefRetryClassifierAdapter', () => {
  const classifier = new KsefRetryClassifierAdapter();

  describe('non-retryable (terminal) errors', () => {
    it('should be non-retryable for a KsefSessionException', () => {
      expect(classifier.isNonRetryable(new KsefSessionException('zero valid invoices'))).toBe(true);
    });

    it('should be non-retryable for an unsupported document type', () => {
      expect(
        classifier.isNonRetryable(new KsefUnsupportedDocumentTypeException('proforma', ['invoice'])),
      ).toBe(true);
    });

    it('should be non-retryable for a deterministic 4xx KsefApiException', () => {
      expect(classifier.isNonRetryable(new KsefApiException('bad request', 400))).toBe(true);
      expect(classifier.isNonRetryable(new KsefApiException('unprocessable', 422))).toBe(true);
    });

    it('should be non-retryable for an FA(3) build fault', () => {
      expect(classifier.isNonRetryable(new UnmappedTaxRateException('not-a-rate'))).toBe(true);
    });

    it('should be non-retryable for an FA(3) validation fault', () => {
      expect(
        classifier.isNonRetryable(new Fa3XsdValidationException([{ path: '/', message: 'bad' }])),
      ).toBe(true);
    });
  });

  describe('retryable (transient) errors', () => {
    it('should be retryable for a KsefNetworkException', () => {
      expect(classifier.isNonRetryable(new KsefNetworkException('connection refused'))).toBe(false);
    });

    it('should be retryable for a 429 rate-limit KsefApiException', () => {
      expect(classifier.isNonRetryable(new KsefApiException('rate limited', 429, undefined, undefined, 1000))).toBe(false);
    });

    it('should be retryable for a 5xx KsefApiException', () => {
      expect(classifier.isNonRetryable(new KsefApiException('server error', 503))).toBe(false);
    });

    it('should be retryable for an unrecognized error (default)', () => {
      expect(classifier.isNonRetryable(new Error('unknown'))).toBe(false);
      expect(classifier.isNonRetryable('not even an error')).toBe(false);
    });
  });
});
