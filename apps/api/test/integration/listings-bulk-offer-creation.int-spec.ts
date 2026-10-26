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
 *  - `x-idempotency-key`: the partial unique index refuses a second batch
 *    under the same `(connectionId, key)` when two creates race, and two
 *    concurrent POSTs replaying a known key both return that batch and
 *    create nothing.
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
  BULK_LISTING_BATCH_REPOSITORY_TOKEN,
  DuplicateBulkBatchIdempotencyKeyError,
} from '@openlinker/core/listings';
import type { CreateBulkListingBatchInput } from '@openlinker/core/listings';

import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';
import { loginAsAdmin } from './helpers/test-auth.helper';

const CONN_A = '11111111-1111-4111-8111-111111111111';
const CONN_B = '22222222-2222-4222-8222-222222222222';

/**
 * The one repository method these cases drive, typed structurally: a
 * `*RepositoryPort` may not be imported across the context boundary, even
 * from a test.
 */
interface BatchCreator {
  create(input: CreateBulkListingBatchInput): Promise<{ id: string }>;
}
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
    idempotencyKey: string | null;
  }> = {}
): Promise<string> {
  const result = (await dataSource.query(
    `INSERT INTO bulk_offer_creation_batches
       ("connectionId", "initiatedBy", "status", "totalCount", "succeededCount", "failedCount", "sharedConfig", "idempotencyKey")
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
     RETURNING id`,
    [
      overrides.connectionId ?? CONN_A,
      overrides.initiatedBy ?? 'user-admin',
      overrides.status ?? 'running',
      overrides.totalCount ?? 2,
      overrides.succeededCount ?? 1,
      overrides.failedCount ?? 0,
      JSON.stringify(overrides.sharedConfig ?? {}),
      overrides.idempotencyKey ?? null,
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

  describe('x-idempotency-key', () => {
    // Counts are scoped by key / connection rather than table-wide: the
    // table carries no FK, so it sits outside the CASCADE closure the harness
    // truncates and rows seeded by earlier cases in this file survive.
    const countBatches = async (
      dataSource: DataSource,
      where: { connectionId: string; idempotencyKey?: string }
    ): Promise<number> => {
      const rows = (await dataSource.query(
        `SELECT COUNT(*)::int AS n FROM bulk_offer_creation_batches
          WHERE "connectionId" = $1 AND ($2::text IS NULL OR "idempotencyKey" = $2)`,
        [where.connectionId, where.idempotencyKey ?? null]
      )) as Array<{ n: number }>;
      return rows[0].n;
    };

    it('should persist exactly one batch when two creates race on the same key', async () => {
      const dataSource = harness.getDataSource();
      const repository = harness.getApp().get<BatchCreator>(BULK_LISTING_BATCH_REPOSITORY_TOKEN);
      const input = {
        connectionId: CONN_A,
        initiatedBy: 'user-admin',
        totalCount: 1,
        sharedConfig: {},
        idempotencyKey: 'race-key',
      };

      const outcomes = await Promise.allSettled([
        repository.create(input),
        repository.create(input),
      ]);

      const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
      const rejected = outcomes.filter((o): o is PromiseRejectedResult => o.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(DuplicateBulkBatchIdempotencyKeyError);
      expect(
        await countBatches(dataSource, { connectionId: CONN_A, idempotencyKey: 'race-key' })
      ).toBe(1);
    });

    it('should still allow any number of keyless batches on one connection', async () => {
      const dataSource = harness.getDataSource();
      const repository = harness.getApp().get<BatchCreator>(BULK_LISTING_BATCH_REPOSITORY_TOKEN);
      const input = {
        connectionId: CONN_B,
        initiatedBy: 'user-admin',
        totalCount: 1,
        sharedConfig: {},
      };
      const before = await countBatches(dataSource, { connectionId: CONN_B });

      await repository.create(input);
      await repository.create(input);

      expect(await countBatches(dataSource, { connectionId: CONN_B })).toBe(before + 2);
    });

    it('should return the existing batch to two concurrent replays and create nothing', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);
      // No connection is seeded: a replay must answer before the adapter is
      // resolved, which is what lets it run here at all.
      const batchId = await seedBatch(dataSource, { idempotencyKey: 'replay-key' });
      const submit = () =>
        http
          .post('/v1/listings/bulk-create')
          .set('Authorization', `Bearer ${token}`)
          .set('x-idempotency-key', 'replay-key')
          .send({
            connectionId: CONN_A,
            productIds: ['ol_variant_a'],
            sharedConfig: { stock: 5, publishImmediately: false },
          });

      const [first, second] = await Promise.all([submit(), submit()]);

      for (const response of [first, second]) {
        expect(response.status).toBe(202);
        expect(response.body).toEqual({
          batchId,
          jobIds: [],
          skippedAlreadyListedCount: 0,
          skippedAvailabilityUnknownCount: 0,
          skippedInvalidEanCount: 0,
          deduplicated: true,
        });
      }
      expect(
        await countBatches(dataSource, { connectionId: CONN_A, idempotencyKey: 'replay-key' })
      ).toBe(1);
    });
  });
});
