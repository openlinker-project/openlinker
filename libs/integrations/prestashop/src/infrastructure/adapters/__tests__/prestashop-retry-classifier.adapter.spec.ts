/**
 * Unit tests for the PrestaShop retry classifier (#581 / #2052 / #2139 / #2616).
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
});
