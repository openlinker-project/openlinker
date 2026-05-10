/**
 * Allegro Retry Classifier Adapter — Unit Tests
 *
 * Pins which Allegro exceptions are non-retryable. The Allegro classifier
 * is the only consumer of these branches (the `SyncJobRunner` was the
 * previous home — moved here in #581) so this spec is the contract.
 *
 * The `AllegroNetworkException` test is load-bearing: pre-#499 these
 * failures were re-classified as auth errors and killed jobs on attempt
 * 1/10 during transient `auth.allegro.pl` blips. Don't relax it.
 *
 * @module libs/integrations/allegro/src/infrastructure/adapters/__tests__
 */
import { AllegroRetryClassifierAdapter } from '../allegro-retry-classifier.adapter';
import { AllegroApiException } from '../../../domain/exceptions/allegro-api.exception';
import { AllegroAuthenticationException } from '../../../domain/exceptions/allegro-authentication.exception';
import { AllegroNetworkException } from '../../../domain/exceptions/allegro-network.exception';

describe('AllegroRetryClassifierAdapter', () => {
  const adapter = new AllegroRetryClassifierAdapter();
  const url = 'https://api.allegro.pl/some/path';

  describe('non-retryable (returns true)', () => {
    it('classifies AllegroAuthenticationException as non-retryable', () => {
      expect(
        adapter.isNonRetryable(new AllegroAuthenticationException('401 Unauthorized', 401, url)),
      ).toBe(true);
    });

    it.each([400, 403, 404, 405, 409, 415, 422])(
      'classifies AllegroApiException with deterministic %i as non-retryable',
      (status) => {
        expect(
          adapter.isNonRetryable(new AllegroApiException('deterministic', status, 'body', url)),
        ).toBe(true);
      },
    );
  });

  describe('retryable (returns false)', () => {
    it.each([500, 502, 503, 408, 425])(
      'does NOT classify AllegroApiException with transient %i as non-retryable',
      (status) => {
        expect(
          adapter.isNonRetryable(new AllegroApiException('transient', status, 'body', url)),
        ).toBe(false);
      },
    );

    // Load-bearing — see #499. Network-level failures are transient and
    // MUST stay retryable. Pre-#499 they were re-classified as auth
    // errors and killed jobs on attempt 1/10 during transient blips.
    it('does NOT classify AllegroNetworkException as non-retryable', () => {
      expect(
        adapter.isNonRetryable(new AllegroNetworkException('fetch failed', url)),
      ).toBe(false);
    });

    it('does NOT classify a plain Error as non-retryable', () => {
      expect(adapter.isNonRetryable(new Error('boom'))).toBe(false);
    });

    it('does NOT classify a non-Error value as non-retryable', () => {
      expect(adapter.isNonRetryable('string error')).toBe(false);
      expect(adapter.isNonRetryable(undefined)).toBe(false);
      expect(adapter.isNonRetryable(null)).toBe(false);
    });

    it('does NOT classify AllegroApiException with no statusCode as non-retryable', () => {
      // statusCode is optional on the constructor; guard against the undefined branch.
      expect(adapter.isNonRetryable(new AllegroApiException('no status', undefined, 'body', url))).toBe(
        false,
      );
    });
  });
});
