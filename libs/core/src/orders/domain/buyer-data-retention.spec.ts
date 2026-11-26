import { buildBuyerPlaceholder, eraseBuyerPersonalDataFromSnapshot } from './buyer-data-retention';

describe('buyer data retention (pure rules)', () => {
  it('should build a stable placeholder that differs per order', () => {
    expect(buildBuyerPlaceholder('ol_order_a')).toBe(buildBuyerPlaceholder('ol_order_a'));
    expect(buildBuyerPlaceholder('ol_order_a')).toMatch(/^KUPUJACY-\d{6}$/);
    expect(buildBuyerPlaceholder('ol_order_a')).not.toBe(buildBuyerPlaceholder('ol_order_b'));
  });

  it('should erase the email and reduce both addresses to country plus placeholder', () => {
    const erased = eraseBuyerPersonalDataFromSnapshot(
      {
        orderNumber: 'A-1',
        customerEmail: 'jan@example.com',
        items: [{ sku: 'SKU' }],
        shippingAddress: {
          firstName: 'Jan',
          lastName: 'Kowalski',
          address1: 'Street 1',
          city: 'Warsaw',
          postalCode: '00-001',
          country: 'PL',
          phone: '123',
        },
        billingAddress: {
          firstName: 'Jan',
          address1: 'X',
          city: 'Y',
          postalCode: 'Z',
          country: 'PL',
          taxId: '123',
        },
      },
      'ol_order_a'
    );
    const text = JSON.stringify(erased);
    expect(text).not.toContain('jan@example.com');
    expect(text).not.toContain('Kowalski');
    expect(text).not.toContain('Street 1');
    expect(text).not.toContain('123');
    expect(erased.orderNumber).toBe('A-1');
    expect(erased.items).toEqual([{ sku: 'SKU' }]);
    expect(erased.shippingAddress).toMatchObject({
      country: 'PL',
      lastName: buildBuyerPlaceholder('ol_order_a'),
    });
  });

  it('should not invent an address the order never had', () => {
    expect(eraseBuyerPersonalDataFromSnapshot({ orderNumber: 'A' }, 'x')).toEqual({
      orderNumber: 'A',
    });
  });
});
