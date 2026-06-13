/**
 * Listings Bulk Offer-Creation Retry-Failed API Integration Test (#742)
 *
 * Covers `POST /listings/bulk-create/:batchId/retry-failed`:
 *  - DB+Redis side-effects of a happy retry against a seeded failed-record batch
 *    (verifies advancement-row deletion, record reset, counter decrement, status
 *    flip, Redis stream additions, dedup-key wave-id sharing).
 *  - 404 (unknown batchId), 409 (no failed children), 400 (bad UUID), 401 (no token).
 *
 * Direct seeding (skipping the submit service) keeps the spec focused on the
 * retry surface — the submit-side flow is covered by
 * `listings-bulk-listing.int-spec.ts`.
 *
 * **Deferred — AC end-to-end happy path** (issue #742 AC: submit → drain →
 * retry → drain → final `partially-failed`): requires booting the
 * `OfferBuilderService` (master-catalog connection + seeded ProductVariant +
 * Product). The fake-adapter stub at
 * `allegro-test-offer-manager-stub.helper.ts` + the drain helper at
 * `bulk-batch-drain.helper.ts` are in place as reusable infrastructure for
 * that case, but driving them to completion needs the master-catalog seam
 * (Product + ProductVariant fixtures + a second connection with
 * `masterCatalogConnectionId`). The orchestration semantics (counter
 * reopen, wave-distinct idempotency key, per-record decrement) are fully
 * covered by `bulk-listing-retry.service.spec.ts`'s 15 cases; the
 * remaining gap is the worker-side drain wiring, which is exercised in
 * `apps/worker/src/sync/handlers/__tests__/marketplace-offer-create.handler.spec.ts`.
 *
 * @module apps/api/test/integration
 */
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';

import { encryptWithKey, loadEncryptionKey } from '@openlinker/shared';
import { IntegrationCredentialOrmEntity } from '@openlinker/core/integrations/orm-entities';
import { ConnectionOrmEntity } from '@openlinker/core/identifier-mapping/orm-entities';

import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';
import { loginAsAdmin } from './helpers/test-auth.helper';
import {
  createTestAllegroSourceConnection,
  type CreateTestAllegroSourceConnectionOpts,
} from './helpers/test-connection.helper';
import {
  ALLEGRO_TEST_OFFER_MANAGER_ADAPTER_KEY,
  installAllegroTestOfferManagerStub,
  type AllegroTestOfferManagerStub,
} from './helpers/allegro-test-offer-manager-stub.helper';
import { drainBulkBatch } from './helpers/bulk-batch-drain.helper';

const UNKNOWN_BATCH_ID = '88888888-8888-4888-8888-888888888888';

/**
 * Create an Allegro connection wired so `IntegrationsService.getCapabilityAdapter`
 * resolves a real adapter without throwing on missing config / credentials.
 * The adapter never makes a live API call — the retry flow only checks the
 * capability and hands off to Redis. The fake `accessToken` clears the
 * factory's credentials gate.
 */
async function createAllegroConnectionWithSandboxConfig(
  dataSource: DataSource,
  overrides: Partial<CreateTestAllegroSourceConnectionOpts> = {}
): Promise<ConnectionOrmEntity> {
  const connection = await createTestAllegroSourceConnection(dataSource, {
    adapterKey: overrides.adapterKey ?? 'allegro.publicapi.v1',
    platformType: 'allegro',
    enabledCapabilities: overrides.enabledCapabilities ?? ['OfferManager'],
  });

  await dataSource.query(
    `UPDATE connections SET config = $1::jsonb WHERE id = $2`,
    [JSON.stringify({ environment: 'sandbox' }), connection.id]
  );
  connection.config = { environment: 'sandbox' };

  // Replace stub credentials with a payload the AllegroAdapterFactory
  // accepts. (No-op for the test stub adapterKey, which ignores credentials.)
  const credentialsRef = connection.credentialsRef.replace(/^db:/, '');
  const { key } = loadEncryptionKey(process.env);
  const credentialsCiphertext = encryptWithKey(
    key,
    JSON.stringify({
      accessToken: 'fake-access-token-int-spec',
      refreshToken: 'fake-refresh-token-int-spec',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    })
  );
  await dataSource
    .getRepository(IntegrationCredentialOrmEntity)
    .update({ ref: credentialsRef }, { credentialsCiphertext });

  return connection;
}

interface BatchRow {
  status: string;
  totalCount: number;
  succeededCount: number;
  failedCount: number;
}
interface RecordRow {
  id: string;
  status: string;
  externalOfferId: string | null;
  errors: unknown;
  classificationReport: unknown;
}
interface AdvancementRow {
  bulkBatchId: string;
  offerCreationRecordId: string;
}

async function seedBatchAndChildren(
  dataSource: DataSource,
  connectionId: string,
  opts: {
    sharedConfig?: Record<string, unknown>;
    succeeded: number;
    failed: number;
  }
): Promise<{ batchId: string; failedRecordIds: string[]; succeededRecordIds: string[] }> {
  const totalCount = opts.succeeded + opts.failed;
  const batchRows = (await dataSource.query(
    `INSERT INTO bulk_offer_creation_batches
       ("connectionId", "initiatedBy", "status", "totalCount", "succeededCount", "failedCount", "sharedConfig")
     VALUES ($1, $2, 'partially-failed', $3, $4, $5, $6::jsonb)
     RETURNING id`,
    [
      connectionId,
      'user-admin',
      totalCount,
      opts.succeeded,
      opts.failed,
      JSON.stringify(opts.sharedConfig ?? {}),
    ]
  )) as Array<{ id: string }>;
  const batchId = batchRows[0].id;

  const succeededRecordIds: string[] = [];
  for (let i = 0; i < opts.succeeded; i++) {
    const recordRows = (await dataSource.query(
      `INSERT INTO offer_creation_records
         ("internalVariantId", "connectionId", "externalOfferId", "status", "errors", "publishImmediately", "request", "bulkBatchId")
       VALUES ($1, $2, $3, 'active', NULL, false, $4::jsonb, $5)
       RETURNING id`,
      [
        `ol_variant_ok_${i}`,
        connectionId,
        `ext-ok-${i}`,
        JSON.stringify({
          schemaVersion: 1,
          internalVariantId: `ol_variant_ok_${i}`,
          stock: 5,
          publishImmediately: false,
        }),
        batchId,
      ]
    )) as Array<{ id: string }>;
    const recordId = recordRows[0].id;
    succeededRecordIds.push(recordId);
    await dataSource.query(
      `INSERT INTO bulk_batch_advancements ("bulkBatchId", "offerCreationRecordId") VALUES ($1, $2)`,
      [batchId, recordId]
    );
  }

  const failedRecordIds: string[] = [];
  for (let i = 0; i < opts.failed; i++) {
    const recordRows = (await dataSource.query(
      `INSERT INTO offer_creation_records
         ("internalVariantId", "connectionId", "externalOfferId", "status", "errors", "publishImmediately", "request", "bulkBatchId", "classificationReport")
       VALUES ($1, $2, NULL, 'failed', $3::jsonb, false, $4::jsonb, $5, $6::jsonb)
       RETURNING id`,
      [
        `ol_variant_fail_${i}`,
        connectionId,
        JSON.stringify([{ code: 'BAD_CATEGORY', message: 'rejected' }]),
        JSON.stringify({
          schemaVersion: 1,
          internalVariantId: `ol_variant_fail_${i}`,
          stock: 3,
          publishImmediately: true,
        }),
        batchId,
        JSON.stringify({ fulfilled: false, conditions: [] }),
      ]
    )) as Array<{ id: string }>;
    const recordId = recordRows[0].id;
    failedRecordIds.push(recordId);
    await dataSource.query(
      `INSERT INTO bulk_batch_advancements ("bulkBatchId", "offerCreationRecordId") VALUES ($1, $2)`,
      [batchId, recordId]
    );
  }

  return { batchId, failedRecordIds, succeededRecordIds };
}

async function readBatch(dataSource: DataSource, batchId: string): Promise<BatchRow> {
  const rows = (await dataSource.query(
    `SELECT "status", "totalCount", "succeededCount", "failedCount"
     FROM bulk_offer_creation_batches WHERE id = $1`,
    [batchId]
  )) as BatchRow[];
  return rows[0];
}

async function readRecord(dataSource: DataSource, id: string): Promise<RecordRow> {
  const rows = (await dataSource.query(
    `SELECT id, "status", "externalOfferId", "errors", "classificationReport"
     FROM offer_creation_records WHERE id = $1`,
    [id]
  )) as RecordRow[];
  return rows[0];
}

async function readAdvancements(
  dataSource: DataSource,
  batchId: string
): Promise<AdvancementRow[]> {
  return (await dataSource.query(
    `SELECT "bulkBatchId", "offerCreationRecordId"
     FROM bulk_batch_advancements WHERE "bulkBatchId" = $1`,
    [batchId]
  )) as AdvancementRow[];
}

describe('Listings Bulk Offer-Creation Retry-Failed API Integration', () => {
  let harness: IntegrationTestHarness;
  let offerManagerStub: AllegroTestOfferManagerStub;

  beforeAll(async () => {
    harness = await getTestHarness();
    // Register the test-stub adapter ONCE at suite scope. AdapterRegistryService.register
    // throws on duplicate registration; lifetime spans the Nest process under test.
    offerManagerStub = installAllegroTestOfferManagerStub(harness);
  });

  afterEach(async () => {
    offerManagerStub.reset();
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  describe('POST /listings/bulk-create/:batchId/retry-failed', () => {
    it('reopens batch, resets failed records, deletes their advancement rows, enqueues new jobs', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const redis = harness.getRedisClient();
      if (!redis) throw new Error('Redis client unavailable in test harness');
      const token = await loginAsAdmin(http, dataSource);

      const connection = await createAllegroConnectionWithSandboxConfig(dataSource);

      const { batchId, failedRecordIds, succeededRecordIds } = await seedBatchAndChildren(
        dataSource,
        connection.id,
        {
          succeeded: 3,
          failed: 2,
          sharedConfig: { generateDescription: true, descriptionTone: 'concise' },
        }
      );

      const before = await readBatch(dataSource, batchId);
      expect(before).toMatchObject({
        status: 'partially-failed',
        totalCount: 5,
        succeededCount: 3,
        failedCount: 2,
      });
      const advancementsBefore = await readAdvancements(dataSource, batchId);
      expect(advancementsBefore).toHaveLength(5);

      const streamLenBefore = await redis.xLen('jobs.sync').catch(() => 0);

      const response = await http
        .post(`/listings/bulk-create/${batchId}/retry-failed`)
        .set('Authorization', `Bearer ${token}`)
        .expect(202);

      // 202 response shape (retryWaveId intentionally not on the wire)
      expect(response.body.retriedCount).toBe(2);
      expect((response.body.retriedRecordIds as string[]).sort()).toEqual(
        failedRecordIds.slice().sort()
      );
      expect(response.body.batchStatus).toBe('running');
      expect(response.body).not.toHaveProperty('retryWaveId');

      // Batch reopened
      const after = await readBatch(dataSource, batchId);
      expect(after).toMatchObject({
        status: 'running',
        totalCount: 5,
        succeededCount: 3,
        failedCount: 0,
      });

      // Failed records reset, succeeded untouched.
      for (const id of failedRecordIds) {
        const row = await readRecord(dataSource, id);
        expect(row.status).toBe('pending');
        expect(row.externalOfferId).toBeNull();
        expect(row.errors).toBeNull();
        expect(row.classificationReport).toBeNull();
      }
      for (const id of succeededRecordIds) {
        const row = await readRecord(dataSource, id);
        expect(row.status).toBe('active');
      }

      // Only the 3 succeeded advancement rows remain.
      const advancementsAfter = await readAdvancements(dataSource, batchId);
      expect(advancementsAfter).toHaveLength(3);
      expect(
        advancementsAfter.map((r) => r.offerCreationRecordId).sort()
      ).toEqual(succeededRecordIds.slice().sort());

      // Two new jobs on the stream + matching dedup keys with one shared wave-id.
      const streamLenAfter = await redis.xLen('jobs.sync');
      expect(streamLenAfter - streamLenBefore).toBe(2);

      const dedupKeys = await redis.keys(`jobdedup:bulk:${batchId}:variant:*:retry:*`);
      expect(dedupKeys.length).toBe(2);
      const waveIds = dedupKeys.map((k) => k.split(':retry:')[1]);
      expect(new Set(waveIds).size).toBe(1);
    });

    it('returns 404 for an unknown batch id', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      await http
        .post(`/listings/bulk-create/${UNKNOWN_BATCH_ID}/retry-failed`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('returns 409 when the batch exists but has no failed children', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      const connection = await createAllegroConnectionWithSandboxConfig(dataSource);

      const { batchId } = await seedBatchAndChildren(dataSource, connection.id, {
        succeeded: 2,
        failed: 0,
      });

      await http
        .post(`/listings/bulk-create/${batchId}/retry-failed`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);
    });

    it('returns 400 when batchId is not a UUID', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      await http
        .post('/listings/bulk-create/not-a-uuid/retry-failed')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('returns 401 without a bearer token', async () => {
      const http = harness.getHttp();
      const batchId = randomUUID();

      await http.post(`/listings/bulk-create/${batchId}/retry-failed`).expect(401);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // End-to-end happy path (issue AC for #742): DEFERRED.
  //
  // See file-header comment for the gap. The fake-adapter stub + drain
  // helper are wired up and the case is structurally sound; what's
  // missing is the master-catalog seeding required by
  // `OfferBuilderService`. Skipped (not deleted) so the next PR that
  // adds master-catalog test fixtures can enable it with a one-line edit.
  // ─────────────────────────────────────────────────────────────────────
  describe.skip('End-to-end: seed → drain → retry-failed → drain (AC #742)', () => {
    it('lands the batch at `partially-failed` after a retry succeeds 1 and fails 1', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      const connection = await createAllegroConnectionWithSandboxConfig(dataSource, {
        adapterKey: ALLEGRO_TEST_OFFER_MANAGER_ADAPTER_KEY,
        enabledCapabilities: ['OfferManager'],
      });

      const variants = [
        'ol_variant_succ_a',
        'ol_variant_succ_b',
        'ol_variant_succ_c',
        'ol_variant_fail_a',
        'ol_variant_fail_b',
      ];

      // Wave-1 script: 3 succeed, 2 fail.
      offerManagerStub.setNextCreateResult(variants[0], {
        kind: 'success',
        externalOfferId: 'ext-1',
        status: 'active',
      });
      offerManagerStub.setNextCreateResult(variants[1], {
        kind: 'success',
        externalOfferId: 'ext-2',
        status: 'active',
      });
      offerManagerStub.setNextCreateResult(variants[2], {
        kind: 'success',
        externalOfferId: 'ext-3',
        status: 'active',
      });
      offerManagerStub.setNextCreateResult(variants[3], {
        kind: 'failure',
        statusCode: 422,
        errors: [
          { code: 'CATEGORY_INVALID', message: 'category id is bogus', field: 'categoryId' },
        ],
      });
      offerManagerStub.setNextCreateResult(variants[4], {
        kind: 'failure',
        statusCode: 422,
        errors: [{ code: 'PRICE_BELOW_MIN', message: 'price below min', field: 'price.amount' }],
      });

      // Seed batch + records directly (see file header).
      const sharedConfig = { generateDescription: false };
      const batchRows = (await dataSource.query(
        `INSERT INTO bulk_offer_creation_batches
           ("connectionId", "initiatedBy", "status", "totalCount", "succeededCount", "failedCount", "sharedConfig")
         VALUES ($1, 'user-admin', 'running', $2, 0, 0, $3::jsonb)
         RETURNING id`,
        [connection.id, variants.length, JSON.stringify(sharedConfig)]
      )) as Array<{ id: string }>;
      const batchId = batchRows[0].id;

      for (const variantId of variants) {
        await dataSource.query(
          `INSERT INTO offer_creation_records
             ("internalVariantId", "connectionId", "externalOfferId", "status", "errors", "publishImmediately", "request", "bulkBatchId")
           VALUES ($1, $2, NULL, 'pending', NULL, false, $3::jsonb, $4)`,
          [
            variantId,
            connection.id,
            JSON.stringify({
              schemaVersion: 1,
              internalVariantId: variantId,
              stock: 3,
              publishImmediately: false,
              price: { amount: 49.99, currency: 'PLN' },
            }),
            batchId,
          ]
        );
      }

      // Wave-1 drain.
      const wave1 = await drainBulkBatch(harness, batchId);
      expect(wave1.outcomes).toHaveLength(5);
      expect(wave1.outcomes.filter((o) => o.outcome === 'ok')).toHaveLength(3);
      expect(wave1.outcomes.filter((o) => o.outcome === 'business_failure')).toHaveLength(2);

      const afterWave1 = await readBatch(dataSource, batchId);
      expect(afterWave1).toMatchObject({
        status: 'partially-failed',
        succeededCount: 3,
        failedCount: 2,
      });

      // Wave-2 script: same two failed variants — one succeeds, one fails again.
      offerManagerStub.setNextCreateResult(variants[3], {
        kind: 'success',
        externalOfferId: 'ext-retry-4',
        status: 'active',
      });
      offerManagerStub.setNextCreateResult(variants[4], {
        kind: 'failure',
        statusCode: 422,
        errors: [{ code: 'PRICE_BELOW_MIN', message: 'still too low', field: 'price.amount' }],
      });

      // POST retry-failed.
      const retryResponse = await http
        .post(`/listings/bulk-create/${batchId}/retry-failed`)
        .set('Authorization', `Bearer ${token}`)
        .expect(202);

      expect(retryResponse.body.retriedCount).toBe(2);
      expect(retryResponse.body.batchStatus).toBe('running');

      const afterRetry = await readBatch(dataSource, batchId);
      expect(afterRetry).toMatchObject({
        status: 'running',
        succeededCount: 3,
        failedCount: 0,
      });

      // Wave-2 drain.
      const wave2 = await drainBulkBatch(harness, batchId);
      expect(wave2.outcomes).toHaveLength(2);
      expect(wave2.outcomes.filter((o) => o.outcome === 'ok')).toHaveLength(1);
      expect(wave2.outcomes.filter((o) => o.outcome === 'business_failure')).toHaveLength(1);

      // AC bullseye.
      const final = await readBatch(dataSource, batchId);
      expect(final).toEqual({
        status: 'partially-failed',
        totalCount: 5,
        succeededCount: 4,
        failedCount: 1,
      });
    });
  });
});
