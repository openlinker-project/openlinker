/**
 * resolveAmazonOrderLineRef tests
 *
 * @module libs/integrations/amazon/src/domain/policies/__tests__
 */
import { resolveAmazonOrderLineRef } from '../amazon-order-line-ref.policy';

describe('resolveAmazonOrderLineRef', () => {
  it('should resolve lines through the variant when the connection is the catalogue', () => {
    expect(resolveAmazonOrderLineRef(['OrderSource', 'ProductMaster', 'InventoryMaster'])).toBe('variant');
  });

  it('should resolve lines through the offer when Amazon only carries offers', () => {
    expect(resolveAmazonOrderLineRef(['OrderSource', 'OfferManager'])).toBe('offer');
    expect(resolveAmazonOrderLineRef(['OrderSource'])).toBe('offer');
  });
});
