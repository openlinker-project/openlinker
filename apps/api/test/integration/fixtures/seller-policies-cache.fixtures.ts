/**
 * Seller Policies Cache Test Fixtures
 *
 * Factory helper for seeding `seller_policies_cache` rows in integration
 * tests. Useful when testing the read path without exercising the Allegro
 * HTTP round-trip.
 *
 * @module apps/api/test/integration/fixtures
 */
import { DataSource } from 'typeorm';
import type { SellerPolicies } from '@openlinker/core/integrations';

export interface TestSellerPoliciesCacheOverrides {
  connectionId?: string;
  policies?: SellerPolicies;
  /** Staleness override — defaults to `now()` (fresh). */
  fetchedAt?: Date;
}

const DEFAULT_POLICIES: SellerPolicies = {
  deliveryPolicies: [{ id: 'd1', name: 'Standard delivery' }],
  returnPolicies: [{ id: 'r1', name: '14-day returns' }],
  warranties: [{ id: 'w1', name: '1-year manufacturer' }],
  impliedWarranties: [{ id: 'iw1', name: 'Consumer rights' }],
};

/**
 * Insert a `seller_policies_cache` row directly via SQL. Returns void
 * because the primary key is `connectionId` which the caller already has.
 */
export async function createTestSellerPoliciesCache(
  dataSource: DataSource,
  overrides?: TestSellerPoliciesCacheOverrides,
): Promise<void> {
  const connectionId = overrides?.connectionId ?? '33333333-3333-4333-8333-333333333333';
  const policies = overrides?.policies ?? DEFAULT_POLICIES;
  const fetchedAt = overrides?.fetchedAt ?? new Date();

  await dataSource.query(
    `INSERT INTO seller_policies_cache ("connectionId", "policies", "fetchedAt")
     VALUES ($1, $2, $3)`,
    [connectionId, JSON.stringify(policies), fetchedAt],
  );
}
