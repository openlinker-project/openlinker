/**
 * Listings Seller-Policies API Integration Test
 *
 * Proves the cache + controller + DTO serialization path end-to-end without
 * needing a live Allegro HTTP round-trip:
 *   1. Seed a fresh row in `seller_policies_cache` for a test connectionId.
 *   2. GET /listings/connections/:id/seller-policies.
 *   3. Expect the seeded policies back, through real Nest wiring + real DB.
 *
 * The adapter's `fetchSellerPolicies` is covered by the Allegro unit spec;
 * the service's cache-hit path is covered by the service unit spec. This
 * test covers the integration seam those two miss: route registration,
 * DTO shape on the wire, and the TypeORM read path.
 *
 * @module apps/api/test/integration
 */
import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';
import { createTestSellerPoliciesCache } from './fixtures/seller-policies-cache.fixtures';
import { loginAsAdmin } from './helpers/test-auth.helper';

const CONN = '33333333-3333-4333-8333-333333333333';

describe('Listings Seller-Policies API Integration', () => {
  let harness: IntegrationTestHarness;

  beforeAll(async () => {
    harness = await getTestHarness();
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('returns seeded cache contents via GET /listings/connections/:id/seller-policies', async () => {
    const http = harness.getHttp();
    const dataSource = harness.getDataSource();
    const token = await loginAsAdmin(http, dataSource);

    const policies = {
      deliveryPolicies: [{ id: 'd1', name: 'Standard' }],
      returnPolicies: [{ id: 'r1', name: '14-day returns' }],
      warranties: [{ id: 'w1', name: '1-year manufacturer' }],
      impliedWarranties: [{ id: 'iw1', name: 'Consumer rights' }],
    };

    await createTestSellerPoliciesCache(dataSource, { connectionId: CONN, policies });

    const response = await http
      .get(`/v1/listings/connections/${CONN}/seller-policies`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body).toEqual(policies);
  });
});
