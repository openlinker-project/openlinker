/**
 * Fulfilment Routing Eligibility — spec (#3487)
 */
import { isOrderFromOwnProductMaster } from './fulfillment-routing-eligibility.types';

describe('isOrderFromOwnProductMaster', () => {
  const shop = { id: 'conn-shop', enabledCapabilities: ['ProductMaster', 'OrderSource'] };
  const marketplace = { id: 'conn-allegro', enabledCapabilities: ['OrderSource', 'OfferManager'] };

  it('should report true when the source connection has ProductMaster enabled', () => {
    expect(isOrderFromOwnProductMaster([shop, marketplace], 'conn-shop')).toBe(true);
  });

  // `enabledCapabilities`, not the advertised list: an operator who switched the
  // catalogue off on a connection has said it is not the operator's own shop.
  it('should report false when the source connection has ProductMaster switched off', () => {
    const shopWithoutCatalogue = { id: 'conn-shop', enabledCapabilities: ['OrderSource'] };
    expect(isOrderFromOwnProductMaster([shopWithoutCatalogue], 'conn-shop')).toBe(false);
  });

  it('should report false when the source connection is not in the list', () => {
    expect(isOrderFromOwnProductMaster([shop], 'conn-unknown')).toBe(false);
  });

  // Decided by the SOURCE connection alone — another connection being a product
  // master says nothing about where this order came from.
  it('should report false when the source is a marketplace and only another connection is a product master', () => {
    expect(isOrderFromOwnProductMaster([shop, marketplace], 'conn-allegro')).toBe(false);
  });
});
