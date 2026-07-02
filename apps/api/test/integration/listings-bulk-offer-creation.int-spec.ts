/**
 * Listings Bulk Offer-Creation API Integration Test (#736)
 *
 * Vertical slice covering:
 *  - `POST /listings/bulk-create` DTO validation: empty productIds (400),
 *    >100 productIds (400), invalid UUID connectionId (400), unknown
 *    connectionId (404 from the integrations service).
 *  - `GET /listings/bulk-create/:batchId` — seeded batch + per-product
 *    records read end-to-end through the controller → service → repo →
 *    Postgres.
 *  - `GET /listings/bulk-create/:batchId` — 404 for unknown batch id.
 *
 * The full happy-path POST is intentionally not exercised end-to-end:
 * the bulk service requires a connection whose adapter supports the
 * `OfferCreator` capability (Allegro), which needs live OAuth
 * credentials. That orchestration is covered by:
 *  - `BulkListingSubmitService` unit spec (fan-out + status flips)
 *  - `OfferCreationEnqueueService` unit spec (V2 payload, bulk idempotency key)
 *  - `BulkListingController` unit spec (DTO mapping, error → HTTP)
 *
 * This int-spec proves Nest wiring + DB plumbing for the operator-facing
 * read contract the FE wizard's progress page (#741) will call every few
 * seconds.
 *
 * @module apps/api/test/integration
 */
import { DataSource } from 'typeorm';

import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';
import { loginAsAdmin } from './helpers/test-auth.helper';

const CONN_A = '11111111-1111-4111-8111-111111111111';
const UNKNOWN_BATCH_ID = '88888888-8888-4888-8888-888888888888';

async function seedBatch(
  dataSource: DataSource,
  overrides: Partial<{
    id: string;
    connectionId: string;
    initiatedBy: string;
    status: 'pending' | 'running' | 'completed' | 'partially-failed' | 'failed';
    totalCount: number;
    succeededCount: number;
    failedCount: number;
    sharedConfig: Record<string, unknown>;
  }> = {}
): Promise<string> {
  const result = (await dataSource.query(
    `INSERT INTO bulk_offer_creation_batches
       ("connectionId", "initiatedBy", "status", "totalCount", "succeededCount", "failedCount", "sharedConfig")
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     RETURNING id`,
    [
      overrides.connectionId ?? CONN_A,
      overrides.initiatedBy ?? 'user-admin',
      overrides.status ?? 'running',
      overrides.totalCount ?? 2,
      overrides.succeededCount ?? 1,
      overrides.failedCount ?? 0,
      JSON.stringify(overrides.sharedConfig ?? {}),
    ]
  )) as Array<{ id: string }>;
  return result[0].id;
}

async function seedRecord(
  dataSource: DataSource,
  bulkBatchId: string,
  overrides: Partial<{
    internalVariantId: string;
    status: 'pending' | 'draft' | 'validating' | 'active' | 'failed';
    externalOfferId: string | null;
    errors: Array<{ field?: string; code: string; message: string }>;
  }> = {}
): Promise<string> {
  const result = (await dataSource.query(
    `INSERT INTO offer_creation_records
       ("internalVariantId", "connectionId", "externalOfferId", "status", "errors", "publishImmediately", "request", "bulkBatchId")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      overrides.internalVariantId ?? 'ol_variant_a',
      CONN_A,
      overrides.externalOfferId ?? null,
      overrides.status ?? 'pending',
      overrides.errors ? JSON.stringify(overrides.errors) : null,
      false,
      null,
      bulkBatchId,
    ]
  )) as Array<{ id: string }>;
  return result[0].id;
}

describe('Listings Bulk Offer-Creation API Integration', () => {
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

  describe('POST /listings/bulk-create — DTO validation', () => {
    it('returns 400 when productIds is empty', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      await http
        .post('/v1/listings/bulk-create')
        .set('Authorization', `Bearer ${token}`)
        .send({
          connectionId: CONN_A,
          productIds: [],
          sharedConfig: { stock: 5, publishImmediately: false },
        })
        .expect(400);
    });

    it('returns 400 when productIds exceeds the 100-item cap', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      const productIds = Array.from({ length: 101 }, (_, i) => `ol_variant_${i}`);

      await http
        .post('/v1/listings/bulk-create')
        .set('Authorization', `Bearer ${token}`)
        .send({
          connectionId: CONN_A,
          productIds,
          sharedConfig: { stock: 5, publishImmediately: false },
        })
        .expect(400);
    });

    it('returns 400 when connectionId is not a UUID', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      await http
        .post('/v1/listings/bulk-create')
        .set('Authorization', `Bearer ${token}`)
        .send({
          connectionId: 'not-a-uuid',
          productIds: ['ol_variant_a'],
          sharedConfig: { stock: 5, publishImmediately: false },
        })
        .expect(400);
    });

    it('returns 404 for a well-formed but unknown connectionId (#1087)', async () => {
      // The bulk service resolves the adapter via
      // `IntegrationsService.getCapabilityAdapter`, which throws
      // `ConnectionNotFoundException` for an unknown connection. The global
      // `ConnectionExceptionFilter` (#1087) maps that to 404 — before the
      // filter it surfaced as a misleading 500.
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      await http
        .post('/v1/listings/bulk-create')
        .set('Authorization', `Bearer ${token}`)
        .send({
          connectionId: CONN_A, // valid UUID, no such connection seeded
          productIds: ['ol_variant_a'],
          sharedConfig: { stock: 5, publishImmediately: false },
        })
        .expect(404);
    });

    it('returns 401 without a bearer token', async () => {
      const http = harness.getHttp();

      await http
        .post('/v1/listings/bulk-create')
        .send({
          connectionId: CONN_A,
          productIds: ['ol_variant_a'],
          sharedConfig: { stock: 5, publishImmediately: false },
        })
        .expect(401);
    });
  });

  describe('GET /listings/bulk-create/:batchId', () => {
    it('returns the batch + per-product records ordered by createdAt ASC', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      const batchId = await seedBatch(dataSource, {
        status: 'running',
        totalCount: 2,
        succeededCount: 1,
        failedCount: 0,
      });
      const recordA = await seedRecord(dataSource, batchId, {
        internalVariantId: 'ol_variant_a',
        status: 'active',
        externalOfferId: 'ext-1',
      });
      // Tiny offset to guarantee deterministic createdAt ordering across
      // SQL inserts that share a millisecond.
      await new Promise((resolve) => setTimeout(resolve, 10));
      const recordB = await seedRecord(dataSource, batchId, {
        internalVariantId: 'ol_variant_b',
        status: 'pending',
      });

      const response = await http
        .get(`/v1/listings/bulk-create/${batchId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.id).toBe(batchId);
      expect(response.body.status).toBe('running');
      expect(response.body.totalCount).toBe(2);
      expect(response.body.succeededCount).toBe(1);
      expect(response.body.failedCount).toBe(0);
      expect(response.body.records).toHaveLength(2);
      expect(response.body.records[0].id).toBe(recordA);
      expect(response.body.records[0].status).toBe('active');
      expect(response.body.records[0].externalOfferId).toBe('ext-1');
      expect(response.body.records[1].id).toBe(recordB);
      expect(response.body.records[1].status).toBe('pending');
      expect(response.body.records[1].externalOfferId).toBeNull();
    });

    it('round-trips structured errors on a failed record (#806)', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      const batchId = await seedBatch(dataSource, {
        status: 'failed',
        totalCount: 1,
        succeededCount: 0,
        failedCount: 1,
      });
      const recordId = await seedRecord(dataSource, batchId, {
        internalVariantId: 'ol_variant_fail',
        status: 'failed',
        errors: [{ field: 'price', code: 'INVALID_PRICE', message: 'Price too low' }],
      });

      const response = await http
        .get(`/v1/listings/bulk-create/${batchId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const record = (response.body.records as Array<{ id: string; errors: unknown }>).find(
        (r) => r.id === recordId
      );
      expect(record?.errors).toEqual([
        { field: 'price', code: 'INVALID_PRICE', message: 'Price too low' },
      ]);
    });

    it('returns an empty records array when the batch has no child rows yet', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      const batchId = await seedBatch(dataSource, {
        status: 'pending',
        totalCount: 3,
      });

      const response = await http
        .get(`/v1/listings/bulk-create/${batchId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.id).toBe(batchId);
      expect(response.body.status).toBe('pending');
      expect(response.body.records).toEqual([]);
    });

    it('returns 404 when the batch id is unknown', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      await http
        .get(`/v1/listings/bulk-create/${UNKNOWN_BATCH_ID}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('returns 400 when the batch id param is not a UUID', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      await http
        .get('/v1/listings/bulk-create/not-a-uuid')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('returns 401 without a bearer token', async () => {
      const http = harness.getHttp();

      await http.get(`/v1/listings/bulk-create/${UNKNOWN_BATCH_ID}`).expect(401);
    });
  });
});
