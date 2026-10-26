/**
 * WooCommerce Retry Classifier Adapter — unit tests
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters/__tests__
 */
import { WooCommerceRetryClassifierAdapter } from '../woocommerce-retry-classifier.adapter';
import { WooCommerceOrderCreateAmbiguousException } from '../../../domain/exceptions/woocommerce-order-create-ambiguous.exception';
import { WooCommerceAmbiguousWriteException } from '../../../domain/exceptions/woocommerce-ambiguous-write.exception';
import { WooCommerceNetworkException } from '../../../domain/exceptions/woocommerce-network.exception';
import { WooCommerceHttpResponseException } from '../../http/woocommerce-http-response.exception';

describe('WooCommerceRetryClassifierAdapter', () => {
  const classifier = new WooCommerceRetryClassifierAdapter();

  it('should classify WooCommerceOrderCreateAmbiguousException as non-retryable (#3469)', () => {
    expect(
      classifier.isNonRetryable(new WooCommerceOrderCreateAmbiguousException('conn-1')),
    ).toBe(true);
  });

  it('should classify WooCommerceAmbiguousWriteException (ambiguous 5xx) as non-retryable (#3469 IMPORTANT-1 review)', () => {
    expect(
      classifier.isNonRetryable(
        new WooCommerceAmbiguousWriteException('ambiguous', 'POST', '/wp-json/wc/v3/orders', 500),
      ),
    ).toBe(true);
  });

  it('should classify WooCommerceAmbiguousWriteException (network error, no statusCode) as non-retryable', () => {
    expect(
      classifier.isNonRetryable(
        new WooCommerceAmbiguousWriteException('network error', 'POST', '/wp-json/wc/v3/orders'),
      ),
    ).toBe(true);
  });

  it('should leave a 5xx WooCommerceHttpResponseException retryable', () => {
    expect(
      classifier.isNonRetryable(new WooCommerceHttpResponseException(500, 'boom', undefined)),
    ).toBe(false);
  });

  it('should leave a network error retryable', () => {
    expect(
      classifier.isNonRetryable(new WooCommerceNetworkException('timeout', new Error('x'))),
    ).toBe(false);
  });

  it('should leave an unrecognized error retryable', () => {
    expect(classifier.isNonRetryable(new Error('unknown'))).toBe(false);
  });
});
