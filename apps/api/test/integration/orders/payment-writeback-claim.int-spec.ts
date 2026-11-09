/**
 * Payment Writeback Column — Integration Test (#3963)
 *
 * The at-most-once guarantee and the problem flag live entirely in SQL: a
 * conditional per-key `jsonb_set` is the claim, and the denormalised
 * `paymentWritebackProblem` flag is recomputed in the same statement. A mocked
 * driver can only assert the statements were composed, not that they hold
 * under two overlapping claims, so this runs against real Postgres.
 *
 * @module apps/api/test/integration/orders
 */
import { ORDER_RECORD_REPOSITORY_TOKEN } from '@openlinker/core/orders';
import type { PaymentWritebackEntry } from '@openlinker/core/orders';

import { createTestOrderRecord } from '../fixtures/order.fixtures';
import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from '../setup';

/**
 * The slice of the repository this spec drives, declared locally: a
 * `*RepositoryPort` is an intra-context contract (see oms-attention.int-spec).
 */
interface PaymentWritebackWriter {
  claimPaymentWriteback(internalOrderId: string, destinationConnectionId: string, staleBefore: Date): Promise<boolean>;
  recordPaymentWriteback(
    internalOrderId: string,
    destinationConnectionId: string,
    entry: PaymentWritebackEntry
  ): Promise<void>;
  markPaymentWritebackHandled(internalOrderIds: readonly string[]): Promise<number>;
  findById(id: string): Promise<{ paymentWriteback: Record<string, PaymentWritebackEntry> } | null>;
  countByHealth(filters: Record<string, unknown>): Promise<{ paymentNotSent: number }>;
  findMany(
    filters: Record<string, unknown>,
    pagination: { limit: number; offset: number }
  ): Promise<{ items: Array<{ internalOrderId: string }>; total: number }>;
}

const PS = 'dest-ps';
const WOO = 'dest-woo';
const AT = '2026-11-04T13:07:00.000Z';
const LONG_AGO = new Date(0);

describe('Payment writeback column (integration, #3963)', () => {
  let harness: IntegrationTestHarness;
  let repository: PaymentWritebackWriter;

  beforeAll(async () => {
    harness = await getTestHarness();
    repository = harness.getApp().get(ORDER_RECORD_REPOSITORY_TOKEN);
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  async function problemFlag(internalOrderId: string): Promise<boolean> {
    const rows = (await harness
      .getDataSource()
      .query(`SELECT "paymentWritebackProblem" FROM "order_records" WHERE "internalOrderId" = $1`, [
        internalOrderId,
      ])) as Array<{ paymentWritebackProblem: boolean }>;
    return rows[0]?.paymentWritebackProblem ?? false;
  }

  it('should let exactly one of two overlapping claims for the same shop win', async () => {
    const order = await createTestOrderRecord(harness.getDataSource());
    await repository.recordPaymentWriteback(order.internalOrderId, PS, { state: 'awaiting', at: AT, attempts: 0 });

    const results = await Promise.all([
      repository.claimPaymentWriteback(order.internalOrderId, PS, LONG_AGO),
      repository.claimPaymentWriteback(order.internalOrderId, PS, LONG_AGO),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    const record = await repository.findById(order.internalOrderId);
    expect(record?.paymentWriteback[PS]?.state).toBe('sending');
  });

  it('should claim each shop on its own, leaving the other shop untouched', async () => {
    const order = await createTestOrderRecord(harness.getDataSource());
    await repository.recordPaymentWriteback(order.internalOrderId, PS, { state: 'awaiting', at: AT, attempts: 0 });
    await repository.recordPaymentWriteback(order.internalOrderId, WOO, {
      state: 'paid-in-shop',
      at: AT,
      attempts: 1,
    });

    await expect(repository.claimPaymentWriteback(order.internalOrderId, PS, LONG_AGO)).resolves.toBe(true);
    await expect(repository.claimPaymentWriteback(order.internalOrderId, WOO, LONG_AGO)).resolves.toBe(false);

    const record = await repository.findById(order.internalOrderId);
    expect(record?.paymentWriteback[WOO]).toEqual(expect.objectContaining({ state: 'paid-in-shop', attempts: 1 }));
  });

  it('should re-claim a sending entry only once it is older than the stale cut-off', async () => {
    const order = await createTestOrderRecord(harness.getDataSource());
    await repository.recordPaymentWriteback(order.internalOrderId, PS, { state: 'awaiting', at: AT, attempts: 0 });
    await repository.claimPaymentWriteback(order.internalOrderId, PS, LONG_AGO);

    await expect(repository.claimPaymentWriteback(order.internalOrderId, PS, LONG_AGO)).resolves.toBe(false);
    await expect(
      repository.claimPaymentWriteback(order.internalOrderId, PS, new Date(Date.now() + 60_000))
    ).resolves.toBe(true);
  });

  it('should raise the problem flag only for a not-sent entry an operator must act on', async () => {
    const order = await createTestOrderRecord(harness.getDataSource());

    await repository.recordPaymentWriteback(order.internalOrderId, PS, {
      state: 'not-sent',
      reason: 'cancelled',
      at: AT,
      attempts: 0,
    });
    expect(await problemFlag(order.internalOrderId)).toBe(false);

    await repository.recordPaymentWriteback(order.internalOrderId, WOO, {
      state: 'not-sent',
      reason: 'retries-exhausted',
      at: AT,
      attempts: 8,
    });
    expect(await problemFlag(order.internalOrderId)).toBe(true);

    const filtered = await repository.findMany({ paymentNotSent: true }, { limit: 10, offset: 0 });
    expect(filtered.items.map((i) => i.internalOrderId)).toEqual([order.internalOrderId]);
    await expect(repository.countByHealth({})).resolves.toEqual(expect.objectContaining({ paymentNotSent: 1 }));
  });

  it('should clear the problem when the operator marks it handled, keeping other entries', async () => {
    const order = await createTestOrderRecord(harness.getDataSource());
    await repository.recordPaymentWriteback(order.internalOrderId, PS, {
      state: 'paid-in-shop',
      at: AT,
      attempts: 1,
    });
    await repository.recordPaymentWriteback(order.internalOrderId, WOO, {
      state: 'not-sent',
      reason: 'rejected',
      at: AT,
      attempts: 1,
    });

    await expect(repository.markPaymentWritebackHandled([order.internalOrderId])).resolves.toBe(1);

    expect(await problemFlag(order.internalOrderId)).toBe(false);
    const record = await repository.findById(order.internalOrderId);
    expect(record?.paymentWriteback[WOO]?.state).toBe('handled');
    expect(record?.paymentWriteback[PS]?.state).toBe('paid-in-shop');
  });
});
