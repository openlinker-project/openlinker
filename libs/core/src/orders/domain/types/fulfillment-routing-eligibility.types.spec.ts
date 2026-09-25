/**
 * Fulfilment Routing Eligibility — spec (#3487, #3488)
 */
import {
  isOrderFromOwnProductMaster,
  isOrderShippedElsewhere,
} from './fulfillment-routing-eligibility.types';

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

describe('isOrderShippedElsewhere', () => {
  it('should report true when a rule routes the delivery method to omp_fulfilled', () => {
    expect(isOrderShippedElsewhere({ source: 'rule', processorKind: 'omp_fulfilled' })).toBe(true);
  });

  // The resolver answers omp_fulfilled for EVERY order no rule covers; reading
  // that as "shipped elsewhere" would stop routing on every rule-less install.
  it('should report false for the omp_fulfilled default when no rule matched', () => {
    expect(isOrderShippedElsewhere({ source: 'default', processorKind: 'omp_fulfilled' })).toBe(
      false
    );
  });

  it('should report false when a rule routes the delivery method to an OL-managed carrier', () => {
    expect(
      isOrderShippedElsewhere({ source: 'rule', processorKind: 'ol_managed_carrier' })
    ).toBe(false);
  });

  it('should report false when a rule routes the delivery method to the source broker', () => {
    expect(isOrderShippedElsewhere({ source: 'rule', processorKind: 'source_brokered' })).toBe(
      false
    );
  });

  // A failed routing read is not a positive answer: the order stays routed.
  it('should report false when the routing could not be resolved', () => {
    expect(isOrderShippedElsewhere(null)).toBe(false);
  });
});
