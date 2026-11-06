import type { Connection } from '@openlinker/core/identifier-mapping';
import type { CachePort } from '@openlinker/shared';

import type { ShopifyTokenMemo } from '../../http/shopify-access-token.provider';
import { ShopifyConnectionArchiveHookAdapter } from '../shopify-connection-archive-hook.adapter';

describe('ShopifyConnectionArchiveHookAdapter', () => {
  it('should drop the minted token and the shop context of the archived connection (K05)', async () => {
    const cache = { get: jest.fn(), set: jest.fn(), delete: jest.fn().mockResolvedValue(undefined) } as unknown as CachePort;
    const memo: ShopifyTokenMemo = new Map([
      ['shopify:access-token:c1', { token: 't', expiresAtMs: Date.now() + 1000, fingerprint: 'f', storeDomain: 'd' }],
      ['shopify:access-token:c2', { token: 'u', expiresAtMs: Date.now() + 1000, fingerprint: 'f', storeDomain: 'd' }],
    ]);

    await new ShopifyConnectionArchiveHookAdapter(cache, memo).onArchived({ id: 'c1' } as Connection);

    expect(cache.delete).toHaveBeenCalledWith('shopify:access-token:c1');
    expect(cache.delete).toHaveBeenCalledWith('shopify:shop-context:c1');
    expect(memo.has('shopify:access-token:c1')).toBe(false);
    expect(memo.has('shopify:access-token:c2')).toBe(true);
  });
});
