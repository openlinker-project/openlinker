/**
 * Order Record Sync-Attempts Integration Test
 *
 * Verifies the per-destination append-only history on `OrderRecord`:
 *   - serial appends preserve chronological order
 *   - per-destination cap is enforced atomically inside the UPDATE
 *   - concurrent writers across destinations don't lose attempts
 *   - missing rows surface OrderRecordNotFoundException
 *
 * Exercises the real `OrderRecordRepository` against Testcontainers Postgres,
 * which is the only reliable way to cover the JSONB window-function +
 * row-lock semantics that protect the timeline from the read-modify-write
 * race the previous implementation had (#456).
 *
 * @module apps/api/test/integration
 */
import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';
import { createTestOrderRecord } from './fixtures/order.fixtures';
import {
  ORDER_RECORD_REPOSITORY_TOKEN,
  OrderRecordNotFoundException,
  OrderRecordRepositoryPort,
  SyncAttempt,
  SYNC_ATTEMPTS_PER_DESTINATION_CAP,
} from '@openlinker/core/orders';

describe('OrderRecord sync attempts (integration)', () => {
  let harness: IntegrationTestHarness;
  let repository: OrderRecordRepositoryPort;

  beforeAll(async () => {
    harness = await getTestHarness();
    repository = harness.getApp().get<OrderRecordRepositoryPort>(ORDER_RECORD_REPOSITORY_TOKEN);
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  function makeAttempt(
    destinationConnectionId: string,
    status: SyncAttempt['status'],
    attemptedAt: Date,
    extras: Partial<SyncAttempt> = {},
  ): SyncAttempt {
    return { destinationConnectionId, status, attemptedAt, ...extras };
  }

  it('preserves chronological order across serial failure → retry → success', async () => {
    const destId = '22222222-2222-4222-8222-222222222222';
    const seeded = await createTestOrderRecord(harness.getDataSource(), {
      syncStatus: [{ destinationConnectionId: destId, status: 'pending' }],
    });

    const t1 = new Date('2026-04-29T22:50:00.000Z');
    const t2 = new Date('2026-04-29T22:55:00.000Z');
    const t3 = new Date('2026-04-29T23:15:00.000Z');

    await repository.updateSyncStatus(
      seeded.internalOrderId,
      destId,
      { destinationConnectionId: destId, status: 'failed', error: 'PL not active' },
      makeAttempt(destId, 'failed', t1, { error: 'PL not active' }),
    );
    await repository.updateSyncStatus(
      seeded.internalOrderId,
      destId,
      { destinationConnectionId: destId, status: 'pending' },
      makeAttempt(destId, 'pending', t2),
    );
    await repository.updateSyncStatus(
      seeded.internalOrderId,
      destId,
      { destinationConnectionId: destId, status: 'synced', externalOrderId: 'ext-1', syncedAt: t3 },
      makeAttempt(destId, 'synced', t3, { externalOrderId: 'ext-1' }),
    );

    const found = await repository.findById(seeded.internalOrderId);
    expect(found).not.toBeNull();
    expect(found!.syncAttempts).toHaveLength(3);
    expect(found!.syncAttempts.map((a) => a.status)).toEqual(['failed', 'pending', 'synced']);
    expect(found!.syncAttempts[0].error).toBe('PL not active');
    expect(found!.syncAttempts[2].externalOrderId).toBe('ext-1');

    // Current state still reflects only the latest row per destination.
    expect(found!.syncStatus).toHaveLength(1);
    expect(found!.syncStatus[0].status).toBe('synced');
  });

  it(`caps per-destination history at ${SYNC_ATTEMPTS_PER_DESTINATION_CAP}, dropping the oldest`, async () => {
    const destId = '22222222-2222-4222-8222-222222222222';
    const seeded = await createTestOrderRecord(harness.getDataSource(), {
      syncStatus: [{ destinationConnectionId: destId, status: 'pending' }],
    });

    const total = SYNC_ATTEMPTS_PER_DESTINATION_CAP + 5;
    for (let i = 0; i < total; i++) {
      const attemptedAt = new Date(Date.UTC(2026, 0, 1, 0, 0, i));
      await repository.updateSyncStatus(
        seeded.internalOrderId,
        destId,
        { destinationConnectionId: destId, status: 'failed', error: `attempt-${i}` },
        makeAttempt(destId, 'failed', attemptedAt, { error: `attempt-${i}` }),
      );
    }

    const found = await repository.findById(seeded.internalOrderId);
    expect(found!.syncAttempts).toHaveLength(SYNC_ATTEMPTS_PER_DESTINATION_CAP);
    // The oldest 5 (attempts 0..4) must be dropped; the newest 20 (5..24) preserved.
    const errors = found!.syncAttempts.map((a) => a.error);
    expect(errors[0]).toBe(`attempt-${total - SYNC_ATTEMPTS_PER_DESTINATION_CAP}`);
    expect(errors[errors.length - 1]).toBe(`attempt-${total - 1}`);
  });

  it('does not lose attempts under concurrent writes across destinations', async () => {
    const dests = [
      '22222222-2222-4222-8222-222222222201',
      '22222222-2222-4222-8222-222222222202',
      '22222222-2222-4222-8222-222222222203',
      '22222222-2222-4222-8222-222222222204',
      '22222222-2222-4222-8222-222222222205',
    ];
    const seeded = await createTestOrderRecord(harness.getDataSource(), {
      syncStatus: dests.map((d) => ({ destinationConnectionId: d, status: 'pending' })),
    });

    const now = new Date('2026-04-30T00:00:00.000Z');
    await Promise.all(
      dests.map((destId, i) =>
        repository.updateSyncStatus(
          seeded.internalOrderId,
          destId,
          { destinationConnectionId: destId, status: 'failed', error: `dest-${i}` },
          makeAttempt(destId, 'failed', new Date(now.getTime() + i * 1000), { error: `dest-${i}` }),
        ),
      ),
    );

    const found = await repository.findById(seeded.internalOrderId);
    expect(found!.syncAttempts).toHaveLength(dests.length);
    const recordedDests = new Set(found!.syncAttempts.map((a) => a.destinationConnectionId));
    expect(recordedDests).toEqual(new Set(dests));
  });

  it('throws OrderRecordNotFoundException when no row matches', async () => {
    const destId = '22222222-2222-4222-8222-222222222222';
    await expect(
      repository.updateSyncStatus(
        'ol_order_does_not_exist',
        destId,
        { destinationConnectionId: destId, status: 'failed' },
        makeAttempt(destId, 'failed', new Date()),
      ),
    ).rejects.toThrow(OrderRecordNotFoundException);
  });
});
