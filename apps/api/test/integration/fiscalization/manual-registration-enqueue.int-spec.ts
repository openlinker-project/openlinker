/**
 * Manual Registration Enqueue Integration Test (#2525)
 *
 * The manual path no longer registers inline; it writes a
 * `fiscalization.register` job and returns. That moves one half of the
 * exactly-once guarantee onto a row this test is about: if a repeated request
 * could write a SECOND job, the same sale would be registered twice, and no
 * amount of care further down would prevent it.
 *
 * The guarantee holds against a real database or not at all, so it is exercised
 * here rather than against a mocked repository:
 *
 *   - two schedules under the deterministic (connection, order) key produce ONE
 *     row, and the second answers with the first one's id;
 *   - the payload the worker will read survives the jsonb round trip carrying
 *     the same key, so the record the job eventually writes is held under the
 *     key the job row is held under.
 *
 * The record-side half of the guarantee - the unique index and the CAS claim -
 * is covered by `fiscal-registration-record-repository.int-spec.ts`.
 *
 * @module apps/api/test/integration/fiscalization
 */
import { fiscalRegistrationIdempotencyKey } from '@openlinker/core/fiscalization';
import { SYNC_JOBS_SERVICE_TOKEN, type ISyncJobsService } from '@openlinker/core/sync';
import { SyncJobOrmEntity } from '@openlinker/core/sync/orm-entities';

import { getTestHarness, resetTestHarness, teardownTestHarness } from '../setup';
import type { IntegrationTestHarness } from '../setup';

const CONNECTION_ID = '00000000-0000-0000-0000-0000000019a8';
const ORDER_ID = 'ol_order_manual_register_1';

describe('manual fiscal registration enqueue (integration)', () => {
  let harness: IntegrationTestHarness;
  let syncJobs: ISyncJobsService;

  beforeAll(async () => {
    harness = await getTestHarness();
    syncJobs = harness.getApp().get<ISyncJobsService>(SYNC_JOBS_SERVICE_TOKEN);
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  function scheduleRegistration(): Promise<{ id: string }> {
    const idempotencyKey = fiscalRegistrationIdempotencyKey(CONNECTION_ID, ORDER_ID);
    return syncJobs.schedule({
      jobType: 'fiscalization.register',
      connectionId: CONNECTION_ID,
      idempotencyKey,
      maxAttempts: 3,
      runAfter: new Date(),
      payload: {
        schemaVersion: 1,
        connectionId: CONNECTION_ID,
        orderId: ORDER_ID,
        idempotencyKey,
        currency: 'PLN',
        lines: [{ name: 'Widget', quantity: 1, unitPriceGross: 100, taxRate: '23', sku: null }],
        totalGross: 100,
        sourceConnectionId: CONNECTION_ID,
      },
    });
  }

  it('should produce ONE job when the same sale is submitted twice', async () => {
    const first = await scheduleRegistration();
    const second = await scheduleRegistration();

    expect(second.id).toBe(first.id);

    const rows = await harness
      .getDataSource()
      .getRepository(SyncJobOrmEntity)
      .find({ where: { jobType: 'fiscalization.register' } });
    expect(rows).toHaveLength(1);
  });

  it('should carry the same exactly-once key into the payload the worker reads', async () => {
    await scheduleRegistration();

    const row = await harness
      .getDataSource()
      .getRepository(SyncJobOrmEntity)
      .findOneOrFail({ where: { jobType: 'fiscalization.register' } });

    // The record the job writes is held under the payload's key. If the two
    // could differ, the job row would dedupe one thing and the record another.
    expect((row.payload as { idempotencyKey?: string }).idempotencyKey).toBe(row.idempotencyKey);
    expect(row.idempotencyKey).toBe(`fiscal:${CONNECTION_ID}:${ORDER_ID}`);
  });
});
