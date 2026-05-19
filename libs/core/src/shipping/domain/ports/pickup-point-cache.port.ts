/**
 * Pickup Point Cache Port
 *
 * Cache contract for paczkomat-style pickup points. Adapter
 * implementation (Redis 24h TTL + background refresh) lives in #766; the
 * port is defined here so this foundation slice can ship the contract
 * downstream issues bind against.
 *
 * Intentionally narrow per engineering-standards §"Repository Ports
 * Pattern" ("keep it minimal — only methods needed by application
 * services"). The single-item shape lets #766's warmer use whatever
 * Redis pipelining / `MSET` strategy it wants below the port; bulk
 * semantics aren't a domain concern. Mirrors
 * `SellerPoliciesCacheRepositoryPort`'s minimalism.
 *
 * No `delete()` / `refresh()` — explicit invalidation isn't a v1 use case
 * (SC-2 is TTL-driven). Add them when a real consumer surfaces.
 *
 * Domain-only — zero framework imports.
 *
 * @module libs/core/src/shipping/domain/ports
 */

import type { PickupPoint } from '../types/pickup-point.types';

export interface PickupPointCachePort {
  /** Returns the cached point, or `null` if absent or expired. Does NOT
   * trigger a refetch from the provider. */
  get(providerId: string): Promise<PickupPoint | null>;

  /** Replace the cached entry for `point.providerId`. TTL handled by the
   * implementation. */
  put(point: PickupPoint): Promise<void>;
}
