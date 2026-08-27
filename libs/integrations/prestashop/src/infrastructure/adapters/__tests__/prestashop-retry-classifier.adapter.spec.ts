/**
 * Unit tests for the PrestaShop retry classifier (#581 / #2052 / #2139 / #2616 / #2613).
 *
 * @module libs/integrations/prestashop/src/infrastructure/adapters
 */
import { PrestashopRetryClassifierAdapter } from '../prestashop-retry-classifier.adapter';
import { PrestashopTaxRateUnknownException } from '../../../domain/exceptions/prestashop-tax-rate-unknown.exception';
import { PrestashopCurrencyUnknownException } from '../../../domain/exceptions/prestashop-currency-unknown.exception';
import { PrestashopInvalidFilterException } from '../../../domain/exceptions/prestashop-invalid-filter.exception';
import { PrestashopApiException } from '../../../domain/exceptions/prestashop-api.exception';
import { PrestashopAuthenticationException } from '../../../domain/exceptions/prestashop-authentication.exception';

describe('PrestashopRetryClassifierAdapter', () => {
  const classifier = new PrestashopRetryClassifierAdapter();

  it('should classify a tax-configuration error as non-retryable', () => {
    expect(
      classifier.isNonRetryable(new PrestashopTaxRateUnknownException('tax rate unknown'))
    ).toBe(true);
  });

  it('should classify an unresolvable order currency as non-retryable', () => {
    expect(
      classifier.isNonRetryable(
        new PrestashopCurrencyUnknownException('Currency EUR unknown in PrestaShop', 'EUR')
      )
    ).toBe(true);
  });

  it('should classify a malformed filter key as non-retryable', () => {
    expect(
      classifier.isNonRetryable(new PrestashopInvalidFilterException('filter[reference]'))
    ).toBe(true);
  });

  it('should keep an API error retryable, including the transport half of the same tax or currency read', () => {
    expect(classifier.isNonRetryable(new PrestashopApiException('gateway timeout', 504))).toBe(
      false
    );
  });

  it('should leave authentication failures to the auth-failure classifier', () => {
    expect(classifier.isNonRetryable(new PrestashopAuthenticationException('unauthorized'))).toBe(
      false
    );
  });

  it('should default an unrecognized error to retryable', () => {
    expect(classifier.isNonRetryable(new Error('boom'))).toBe(false);
    expect(classifier.isNonRetryable('not an error')).toBe(false);
    expect(classifier.isNonRetryable(undefined)).toBe(false);
  });

  describe('getRetryDeferral (#2613)', () => {
    it('should defer a 429 with its own reason when the shop named no wait', () => {
      const deferral = classifier.getRetryDeferral(
        new PrestashopApiException('PrestaShop API error (429): /products', 429)
      );

      expect(deferral).toEqual({
        delaySeconds: 60,
        reason: 'shop rate-limited the request (429)',
      });
    });

    it('should honour Retry-After on a 429 when the shop sent one', () => {
      const deferral = classifier.getRetryDeferral(
        new PrestashopApiException(
          'PrestaShop API error (429): /products',
          429,
          undefined,
          undefined,
          120
        )
      );

      expect(deferral?.delaySeconds).toBe(120);
    });

    it('should not let a short Retry-After retry sooner than the runner backoff would have', () => {
      const deferral = classifier.getRetryDeferral(
        new PrestashopApiException(
          'PrestaShop API error (429): /products',
          429,
          undefined,
          undefined,
          1
        )
      );

      expect(deferral?.delaySeconds).toBe(30);
    });

    it('should defer a 503 on a longer maintenance-shaped delay and its own reason', () => {
      const deferral = classifier.getRetryDeferral(
        new PrestashopApiException('PrestaShop API server error (503): /orders', 503)
      );

      expect(deferral).toEqual({
        delaySeconds: 300,
        reason: 'shop unavailable (503)',
      });
    });

    it('should keep 429 and 503 retryable so neither can be terminalised', () => {
      expect(classifier.isNonRetryable(new PrestashopApiException('rate limited', 429))).toBe(
        false
      );
      expect(classifier.isNonRetryable(new PrestashopApiException('unavailable', 503))).toBe(false);
    });

    it('should not defer any other failure', () => {
      expect(classifier.getRetryDeferral(new PrestashopApiException('boom', 500))).toBeNull();
      expect(classifier.getRetryDeferral(new PrestashopApiException('teapot', 418))).toBeNull();
      expect(classifier.getRetryDeferral(new PrestashopApiException('no status'))).toBeNull();
      expect(classifier.getRetryDeferral(new Error('boom'))).toBeNull();
      expect(classifier.getRetryDeferral(undefined)).toBeNull();
    });
  });
});
