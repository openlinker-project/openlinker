/**
 * Seller Policies Service Interface
 *
 * Contract for the core read service that returns marketplace seller-configured
 * policies (delivery / return / warranty / implied-warranty). Implemented by
 * `SellerPoliciesService`; consumed by the HTTP layer so the FE offer-creation
 * wizard (#261) can populate policy dropdowns without re-hitting the
 * marketplace API on every render.
 *
 * @module libs/core/src/listings/application/interfaces
 */

import type { SellerPolicies } from '@openlinker/core/integrations';

export interface ISellerPoliciesService {
  /**
   * Return seller policies for a connection.
   *
   * Cache-aside: if the cache row is fresh (`fetchedAt > now - TTL`), returns
   * it without calling the adapter. On a miss/stale, resolves the Marketplace
   * adapter for the connection, invokes `fetchSellerPolicies()`, upserts the
   * cache, and returns the fresh value.
   *
   * Throws:
   * - `ConnectionNotFoundException` (→ HTTP 404) when the connection does not exist.
   * - `ConnectionDisabledException` (→ HTTP 409) when the connection is disabled.
   * - `CapabilityNotSupportedException` (→ HTTP 422) when the connection's
   *   adapter does not implement `Marketplace` at all.
   * - `UnprocessableEntityException` (→ HTTP 422) when the adapter supports
   *   `Marketplace` but does not implement `fetchSellerPolicies`.
   *
   * A cache-write failure after a successful adapter call is logged and
   * swallowed — the fresh policies are returned to the caller regardless
   * (cache-aside resilience).
   */
  getSellerPolicies(connectionId: string): Promise<SellerPolicies>;
}
