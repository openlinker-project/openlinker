/**
 * @module libs/integrations/woocommerce/src/infrastructure/adapters/__tests__
 */
import { WooCommerceAuthFailureClassifierAdapter } from '../woocommerce-auth-failure-classifier.adapter';
import { WooCommerceUnauthorizedException } from '../../../domain/exceptions/woocommerce-unauthorized.exception';
import { WooCommerceHttpResponseException } from '../../http/woocommerce-http-response.exception';

describe('WooCommerceAuthFailureClassifierAdapter', () => {
  const classifier = new WooCommerceAuthFailureClassifierAdapter();

  it('should return true for WooCommerceUnauthorizedException', () => {
    const error = new WooCommerceUnauthorizedException('auth failed');
    expect(classifier.isCredentialRejected(error)).toBe(true);
  });

  it('should return false for WooCommerceHttpResponseException (e.g. 500)', () => {
    const error = new WooCommerceHttpResponseException(500, 'internal error');
    expect(classifier.isCredentialRejected(error)).toBe(false);
  });

  it('should return false for a generic Error', () => {
    expect(classifier.isCredentialRejected(new Error('network failure'))).toBe(false);
  });
});
