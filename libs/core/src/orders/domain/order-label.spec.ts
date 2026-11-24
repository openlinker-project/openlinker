/**
 * Order label — unit spec (#3584)
 *
 * @module libs/core/src/orders/domain
 */
import { REDACTED_PLACEHOLDER } from './order-address-redaction';
import { readOrderLabel } from './order-label';

describe('readOrderLabel', () => {
  it('should read the order number and the billing name', () => {
    expect(
      readOrderLabel({
        orderNumber: 'ALG-1',
        billingAddress: { firstName: 'Anna', lastName: 'Kowalska' },
        shippingAddress: { firstName: 'Jan', lastName: 'Nowak' },
      })
    ).toEqual({ orderNumber: 'ALG-1', buyerName: 'Anna Kowalska' });
  });

  it('should fall back to the shipping name when there is no billing name', () => {
    expect(readOrderLabel({ shippingAddress: { firstName: 'Jan', lastName: 'Nowak' } })).toEqual({
      orderNumber: null,
      buyerName: 'Jan Nowak',
    });
  });

  it('should read a redacted name as absent rather than the sentinel', () => {
    expect(
      readOrderLabel({
        billingAddress: { firstName: REDACTED_PLACEHOLDER, lastName: REDACTED_PLACEHOLDER },
      }).buyerName
    ).toBeNull();
  });

  it('should answer nothing for a snapshot that is not an object', () => {
    expect(readOrderLabel(null)).toEqual({ orderNumber: null, buyerName: null });
  });
});
