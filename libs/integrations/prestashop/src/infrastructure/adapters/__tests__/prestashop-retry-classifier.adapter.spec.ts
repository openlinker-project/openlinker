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
import { PrestashopOlModuleException } from '../../../domain/exceptions/prestashop-ol-module.exception';
import { PrestashopAuthenticationException } from '../../../domain/exceptions/prestashop-authentication.exception';
import { PrestashopAmbiguousWriteException } from '../../../domain/exceptions/prestashop-ambiguous-write.exception';

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

    it.each([
      'payment-module-inactive',
      'payment-module-unavailable',
      'invalid-fields',
      'line-prices-do-not-match-cart',
      'non-json-module-response',
      'invalid-signature',
    ])(
      'should refuse to retry a module refusal of %s (#2601 review, finding 3)',
      (reason: string) => {
        expect(
          classifier.isNonRetryable(new PrestashopOlModuleException('conn-1', 42, 422, reason))
        ).toBe(true);
      }
    );

    it.each([
      ['persist-failed', 500],
      ['validate-order-failed', 502],
      ['line-price-pin-failed', 502],
      ['network: fetch failed', 0],
    ])(
      'should keep a module failure of %s retryable, because the shop can answer differently',
      (reason: string, status: number) => {
        expect(
          classifier.isNonRetryable(new PrestashopOlModuleException('conn-1', 42, status, reason))
        ).toBe(false);
      }
    );

    it('should keep a module refusal this build does not recognise retryable', () => {
      // A newer module inventing a reason gets the pre-existing behaviour
      // rather than being made terminal by omission.
      expect(
        classifier.isNonRetryable(
          new PrestashopOlModuleException('conn-1', 42, 400, 'some-future-reason')
        )
      ).toBe(false);
      expect(classifier.isNonRetryable(new PrestashopOlModuleException('conn-1', 42, 400))).toBe(
        false
      );
    });

    it('should not defer any other failure', () => {
      expect(classifier.getRetryDeferral(new PrestashopApiException('boom', 500))).toBeNull();
      expect(classifier.getRetryDeferral(new PrestashopApiException('teapot', 418))).toBeNull();
      expect(classifier.getRetryDeferral(new PrestashopApiException('no status'))).toBeNull();
      expect(classifier.getRetryDeferral(new Error('boom'))).toBeNull();
      expect(classifier.getRetryDeferral(undefined)).toBeNull();
    });
  });

  describe('getRetryDeferral through a re-wrapped cause (#3984)', () => {
    const wrap = (cause: Error): PrestashopApiException =>
      new PrestashopApiException(
        `Failed to create PrestaShop order: ${cause.message}`,
        undefined,
        undefined,
        undefined,
        undefined,
        cause
      );

    it('should defer a 503 carried as the cause of a re-wrapped error', () => {
      const deferral = classifier.getRetryDeferral(
        wrap(new PrestashopApiException('unavailable', 503))
      );

      expect(deferral).toEqual({ delaySeconds: 300, reason: 'shop unavailable (503)' });
    });

    it('should defer a 429 behind two levels of wrapping and honour its Retry-After', () => {
      const inner = new PrestashopApiException('slow down', 429, undefined, undefined, 120);

      expect(classifier.getRetryDeferral(wrap(wrap(inner)))).toEqual({
        delaySeconds: 120,
        reason: 'shop rate-limited the request (429)',
      });
    });

    it('should defer a module 429 behind a wrapper', () => {
      const deferral = classifier.getRetryDeferral(
        wrap(new PrestashopOlModuleException('conn', 1, 429, 'http-429'))
      );

      expect(deferral?.reason).toBe('shop rate-limited the request (429)');
    });

    it('should not defer a module 503, which may have committed the order', () => {
      expect(
        classifier.getRetryDeferral(
          wrap(new PrestashopOlModuleException('conn', 1, 503, 'http-503'))
        )
      ).toBeNull();
    });

    it('should not defer when an ambiguous write sits anywhere in the chain', () => {
      const ambiguous = new PrestashopAmbiguousWriteException('boom', 'POST', 'importorder', 503);

      expect(classifier.getRetryDeferral(wrap(ambiguous))).toBeNull();
      expect(classifier.getRetryDeferral(ambiguous)).toBeNull();
    });

    it('should not defer a wrapped 500 or a wrapped plain error', () => {
      expect(classifier.getRetryDeferral(wrap(new PrestashopApiException('boom', 500)))).toBeNull();
      expect(classifier.getRetryDeferral(wrap(new Error('validation failed')))).toBeNull();
    });

    it('should stay retryable rather than terminal for a wrapped 503', () => {
      expect(classifier.isNonRetryable(wrap(new PrestashopApiException('unavailable', 503)))).toBe(
        false
      );
    });
  });

  describe('PrestashopAmbiguousWriteException (#3469 IMPORTANT-1 review)', () => {
    it('should classify an ambiguous 5xx write as non-retryable', () => {
      expect(
        classifier.isNonRetryable(
          new PrestashopAmbiguousWriteException('ambiguous', 'POST', 'customers', 500)
        )
      ).toBe(true);
    });

    it('should classify an ambiguous network-error write (no statusCode) as non-retryable', () => {
      expect(
        classifier.isNonRetryable(
          new PrestashopAmbiguousWriteException('network error', 'POST', 'importorder')
        )
      ).toBe(true);
    });

    it('should leave a plain 5xx PrestashopApiException (an idempotent GET/PUT) retryable', () => {
      expect(classifier.isNonRetryable(new PrestashopApiException('transient', 500))).toBe(false);
    });
  });
});
