import { projectOrderForRouting } from './project-order-for-routing';
import type { Order } from './types/order.types';

function orderWith(overrides: Partial<Order> = {}): Order {
  return {
    items: [
      { id: 'line-1', productId: 'ol_product_1', variantId: 'ol_variant_1', quantity: 2 },
      { id: 'line-2', productId: 'ol_product_2', quantity: 1 },
    ],
    shippingAddress: {
      firstName: 'Jan',
      lastName: 'Kowalski',
      address1: 'Tajna 1',
      city: 'Poznań',
      postalCode: '61-000',
      country: 'PL',
      phone: '+48123456789',
    },
    shipping: { methodId: 'kurier' },
    ...overrides,
  } as unknown as Order;
}

describe('projectOrderForRouting', () => {
  it('should return null when the order has no shipping address', () => {
    expect(
      projectOrderForRouting(orderWith({ shippingAddress: undefined }), null, true)
    ).toBeNull();
  });

  it('should fall back to the product id when a line has no variant', () => {
    const projection = projectOrderForRouting(orderWith(), null, true);

    expect(projection?.lines).toEqual([
      { orderLineId: 'line-1', productVariantId: 'ol_variant_1', quantity: 2 },
      { orderLineId: 'line-2', productVariantId: 'ol_product_2', quantity: 1 },
    ]);
  });

  it('should carry the source delivery method id verbatim, or null', () => {
    expect(projectOrderForRouting(orderWith(), null, true)?.requestedDeliveryMethod).toBe('kurier');
    expect(
      projectOrderForRouting(orderWith({ shipping: undefined }), null, true)
        ?.requestedDeliveryMethod
    ).toBeNull();
  });

  it('should never put buyer name, phone or street into the projection', () => {
    const serialized = JSON.stringify(projectOrderForRouting(orderWith(), null, true));

    for (const leaked of ['Jan', 'Kowalski', 'Tajna', '+48123456789']) {
      expect(serialized).not.toContain(leaked);
    }
  });

  it('should use the hashed arm and the supplied hash when PII is not stored', () => {
    const projection = projectOrderForRouting(orderWith(), 'a'.repeat(64), false);

    expect(projection?.shipTo.mode).toBe('hashed');
    expect(JSON.stringify(projection?.shipTo)).toContain('a'.repeat(64));
  });
});
