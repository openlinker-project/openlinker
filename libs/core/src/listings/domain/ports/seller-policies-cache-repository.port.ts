/**
 * Seller Policies Cache Repository Port
 *
 * Persistence contract for cached marketplace seller policies (delivery /
 * return / warranty / implied-warranty). The cache is keyed by `connectionId`
 * — one row per connection — and is consulted before the adapter's live
 * `fetchSellerPolicies` call to absorb repeated wizard loads within the TTL.
 *
 * Implemented in the listings infrastructure layer; application services
 * depend on this port (not the concrete repo) per `docs/engineering-standards.md`
 * → Repository Ports Pattern.
 *
 * @module libs/core/src/listings/domain/ports
 */

import { SellerPolicies } from '@openlinker/core/listings';

/**
 * Cached seller-policies entry. `fetchedAt` is the canonical TTL reference —
 * callers compare against `now - TTL` to decide whether to refresh.
 */
export interface CachedSellerPolicies {
  connectionId: string;
  policies: SellerPolicies;
  fetchedAt: Date;
}

export interface SellerPoliciesCacheRepositoryPort {
  /**
   * Look up the cache row for a connection. Returns null when no row exists.
   */
  findByConnectionId(connectionId: string): Promise<CachedSellerPolicies | null>;

  /**
   * Write a cache entry. Insert-or-update semantics on `connectionId` —
   * a stale row for the same connection is overwritten.
   */
  upsert(entry: CachedSellerPolicies): Promise<void>;
}
