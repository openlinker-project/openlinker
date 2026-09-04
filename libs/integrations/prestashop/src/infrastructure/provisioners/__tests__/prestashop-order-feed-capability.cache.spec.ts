/**
 * PrestaShop Order-Feed Capability Cache Tests
 *
 * @module libs/integrations/prestashop/src/infrastructure/provisioners/__tests__
 */
import { PrestashopOrderFeedCapabilityCache } from '../prestashop-order-feed-capability.cache';

describe('PrestashopOrderFeedCapabilityCache', () => {
  it('should report a connection as supported by default', () => {
    const cache = new PrestashopOrderFeedCapabilityCache();
    expect(cache.isDateUpdSortKnownUnsupported('conn-1')).toBe(false);
  });

  it('should remember a connection marked unsupported', () => {
    const cache = new PrestashopOrderFeedCapabilityCache();
    cache.markDateUpdSortUnsupported('conn-1');
    expect(cache.isDateUpdSortKnownUnsupported('conn-1')).toBe(true);
  });

  it('should scope the answer per connection', () => {
    const cache = new PrestashopOrderFeedCapabilityCache();
    cache.markDateUpdSortUnsupported('conn-1');
    expect(cache.isDateUpdSortKnownUnsupported('conn-2')).toBe(false);
  });
});
