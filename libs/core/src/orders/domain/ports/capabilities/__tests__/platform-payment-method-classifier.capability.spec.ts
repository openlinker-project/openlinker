/**
 * Platform payment-method classifier capability guard - unit tests (#3774)
 *
 * @module libs/core/src/orders/domain/ports/capabilities/__tests__
 */
import type { OrderSourcePort } from '../../order-source.port';
import {
  type PlatformPaymentMethodClassifier,
  isPlatformPaymentMethodClassifier,
} from '../platform-payment-method-classifier.capability';

describe('isPlatformPaymentMethodClassifier', () => {
  const base: OrderSourcePort = { listOrderFeed: jest.fn(), getOrder: jest.fn() };

  it('should return true when the adapter implements classifyPlatformPaymentMethod', () => {
    const withCapability: OrderSourcePort & PlatformPaymentMethodClassifier = {
      ...base,
      classifyPlatformPaymentMethod: jest.fn(),
    };

    expect(isPlatformPaymentMethodClassifier(withCapability)).toBe(true);
  });

  it('should return false when the adapter does not implement it', () => {
    expect(isPlatformPaymentMethodClassifier(base)).toBe(false);
  });

  it('should return false when the member is present but not a function', () => {
    const malformed = {
      ...base,
      classifyPlatformPaymentMethod: 'cod',
    } as unknown as OrderSourcePort;

    expect(isPlatformPaymentMethodClassifier(malformed)).toBe(false);
  });
});
