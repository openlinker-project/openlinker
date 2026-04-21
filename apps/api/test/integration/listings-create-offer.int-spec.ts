/**
 * Listings Create-Offer API Integration Test
 *
 * Vertical slice covering:
 * - GET /listings/connections/:id/offers/creation/:recordId — seeded record path
 * - GET /listings/connections/:id/offers/creation/:recordId — not-found path
 * - GET /listings/connections/:id/offers/creation/:recordId — cross-connection
 *     (exists but belongs to a different connection → 404)
 *
 * We do **not** exercise `POST /offers` end-to-end here because a real Allegro
 * adapter would need live credentials; that path is covered by the controller
 * unit spec (`ListingsController`), the `OfferCreationEnqueueService` spec
 * (adapter/capability/record/enqueue orchestration), and the worker-handler
 * spec (`OfferCreationExecutionService`). The integration test's job is to
 * prove Nest wiring + DB plumbing for the status-poll endpoint which is the
 * operator-visible contract the FE will call every few seconds.
 *
 * @module apps/api/test/integration
 */
import { getTestHarness, IntegrationTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { createTestOfferCreationRecord } from './fixtures/offer-creation-record.fixtures';
import { loginAsAdmin } from './helpers/test-auth.helper';

const CONN_A = '11111111-1111-4111-8111-111111111111';
const CONN_B = '22222222-2222-4222-8222-222222222222';

describe('Listings Create-Offer API Integration', () => {
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

  describe('GET /listings/connections/:connectionId/offers/creation/:offerCreationRecordId', () => {
    it('returns the record for an authenticated operator when the record belongs to the connection', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      const recordId = await createTestOfferCreationRecord(dataSource, {
        connectionId: CONN_A,
        status: 'validating',
      });

      const response = await http
        .get(`/listings/connections/${CONN_A}/offers/creation/${recordId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.id).toBe(recordId);
      expect(response.body.connectionId).toBe(CONN_A);
      expect(response.body.internalVariantId).toBe('ol_variant_abc123');
      expect(response.body.status).toBe('validating');
      expect(response.body.externalOfferId).toBeNull();
      expect(response.body.errors).toBeNull();
      expect(response.body.publishImmediately).toBe(false);
      expect(typeof response.body.createdAt).toBe('string');
      expect(typeof response.body.updatedAt).toBe('string');
    });

    it('returns 404 when the record does not exist', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      await http
        .get(`/listings/connections/${CONN_A}/offers/creation/00000000-0000-4000-8000-000000000000`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('returns 404 when the record exists but belongs to a different connection', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      const recordId = await createTestOfferCreationRecord(dataSource, { connectionId: CONN_B });

      await http
        .get(`/listings/connections/${CONN_A}/offers/creation/${recordId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });
});
