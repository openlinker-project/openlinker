/**
 * Shopify Connection Archive Hook
 *
 * Drops the connection's minted access token and cached shop context when the
 * connection is archived (K05: the token stayed in Redis for its ~24 h life
 * after the credential that minted it was deleted). Both live under one key
 * per connection, so nothing about the deleted credential is needed. The
 * per-process memo of THIS process is cleared too; another process's memo
 * holds an entry it can no longer use (the credential is gone), which expires
 * with the token.
 *
 * @module libs/integrations/shopify/src/infrastructure/adapters
 */
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { ConnectionArchiveHookPort } from '@openlinker/core/integrations';
import type { CachePort } from '@openlinker/shared';

import {
  shopifyAccessTokenCacheKey,
  shopifyShopContextCacheKey,
} from '../../domain/policies/shopify-credentials.policy';
import type { ShopifyTokenMemo } from '../http/shopify-access-token.provider';

export class ShopifyConnectionArchiveHookAdapter implements ConnectionArchiveHookPort {
  constructor(
    private readonly cache: CachePort | undefined,
    private readonly tokenMemo: ShopifyTokenMemo,
  ) {}

  async onArchived(connection: Connection): Promise<void> {
    const tokenKey = shopifyAccessTokenCacheKey(connection.id);
    this.tokenMemo.delete(tokenKey);
    if (this.cache !== undefined) {
      await this.cache.delete(tokenKey);
      await this.cache.delete(shopifyShopContextCacheKey(connection.id));
    }
  }
}
