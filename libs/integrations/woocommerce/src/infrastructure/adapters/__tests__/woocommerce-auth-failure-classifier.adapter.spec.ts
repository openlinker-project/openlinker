/**
 * WooCommerce Auth Failure Classifier Adapter — Unit Tests
 *
 * Pins that only WooCommerceUnauthorizedException and
 * WooCommerceAuthFailureException are treated as credential rejections (#819).
 * All other WooCommerce exceptions — including WooCommerceOrderProcessingException
 * — must NOT trigger connection re-auth.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters/__tests__
 */
import { WooCommerceAuthFailureClassifierAdapter } from '../woocommerce-auth-failure-classifier.adapter';
import { WooCommerceUnauthorizedException } from '../../../domain/exceptions/woocommerce-unauthorized.exception';
import { WooCommerceAuthFailureException } from '../../../domain/exceptions/woocommerce-auth-failure.exception';
import { WooCommerceOrderProcessingException } from '../../../domain/exceptions/woocommerce-order-processing.exception';
import { WooCommerceResourceNotFoundException } from '../../../domain/exceptions/woocommerce-resource-not-found.exception';

describe('WooCommerceAuthFailureClassifierAdapter', () => {
  const classifier = new WooCommerceAuthFailureClassifierAdapter();

  it('should classify WooCommerceUnauthorizedException as a credential rejection', () => {
    const err = new WooCommerceUnauthorizedException('401 Unauthorized');
    expect(classifier.isCredentialRejected(err)).toBe(true);
  });

  it('should classify WooCommerceAuthFailureException as a credential rejection', () => {
    const err = new WooCommerceAuthFailureException('403 Forbidden during order creation', 'conn-1');
    expect(classifier.isCredentialRejected(err)).toBe(true);
  });

  it('should NOT classify WooCommerceOrderProcessingException as a credential rejection', () => {
    const err = new WooCommerceOrderProcessingException('order data invalid', 'conn-1');
    expect(classifier.isCredentialRejected(err)).toBe(false);
  });

  it('should NOT classify WooCommerceResourceNotFoundException as a credential rejection', () => {
    const err = new WooCommerceResourceNotFoundException(
      'product not found',
      'Product',
      'ol_product_abc123',
      'conn-1',
    );
    expect(classifier.isCredentialRejected(err)).toBe(false);
  });

  it('should NOT classify unknown errors as credential rejections', () => {
    expect(classifier.isCredentialRejected(new Error('network error'))).toBe(false);
    expect(classifier.isCredentialRejected('string error')).toBe(false);
    expect(classifier.isCredentialRejected(undefined)).toBe(false);
    expect(classifier.isCredentialRejected(null)).toBe(false);
  });
});
