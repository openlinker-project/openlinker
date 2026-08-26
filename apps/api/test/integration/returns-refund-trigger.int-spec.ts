/**
 * Return Refund Trigger Integration Test (#2371, `W2-34`, ADR-056)
 *
 * Three properties earn integration coverage specifically because a unit spec
 * cannot reach them:
 *
 *  - **the boot-time DI gate** — `RETURN_REFUND_SERVICE_TOKEN` resolves off the
 *    real api graph. Nest imports are not transitive and DI wiring is invisible
 *    to the compiler, so a missing provider binding surfaces only here (proved
 *    real by removing the binding from `ReturnsModule` and watching this fail);
 *  - **the claim is a real conditional UPDATE** — a second `triggerRefund`
 *    claiming zero rows is a property of the SQL predicate, and the repository's
 *    unit spec drives a chainable builder mock that would accept a wrong column
 *    name silently;
 *  - **the `refund_records.executedBy` migration applied** — the column's
 *    NOT NULL DEFAULT is the whole backfill story, and only a real database
 *    proves the default is what a pre-existing row would carry.
 *
 * The `RefundRecord` write is performed HERE, by the test, through
 * `IOrderRefundService` — exactly as #2376's controller will. That is the point
 * of the #2100 report-don't-persist seam: `ReturnRefundService` reports an
 * intent and never reaches an orders write itself.
 *
 * @module apps/api/test/integration
 */
import {
  CORE_ENTITY_TYPE,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  type IIdentifierMappingService,
} from '@openlinker/core/identifier-mapping';
import {
  ORDER_REFUND_SERVICE_TOKEN,
  type IOrderRefundService,
} from '@openlinker/core/orders';
import {
  RETURN_REFUND_SERVICE_TOKEN,
  RETURNS_SERVICE_TOKEN,
  type IReturnRefundService,
  type IReturnsService,
  type IncomingReturn,
} from '@openlinker/core/returns';

import { createTestConnection } from './helpers/test-connection.helper';
import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';

// Set in this file rather than relied upon from a sibling: under `maxWorkers: 1`
// a value another spec happens to set is leakage, not configuration.
process.env.OL_PII_HASH_SALT = process.env.OL_PII_HASH_SALT ?? 'returns-refund-int-spec-salt';

describe('Return Refund Trigger Integration', () => {
  let harness: IntegrationTestHarness;
  let connectionId: string;

  const refunds = (): IReturnRefundService =>
    harness.getApp().get<IReturnRefundService>(RETURN_REFUND_SERVICE_TOKEN, { strict: false });

  const returns = (): IReturnsService =>
    harness.getApp().get<IReturnsService>(RETURNS_SERVICE_TOKEN, { strict: false });

  const orderRefunds = (): IOrderRefundService =>
    harness.getApp().get<IOrderRefundService>(ORDER_REFUND_SERVICE_TOKEN, { strict: false });

  const observation = (externalOrderId: string): IncomingReturn => ({
    externalReturnId: 'RET-REFUND-1',
    externalOrderId,
    rawStatus: 'DELIVERED',
    createdAt: '2026-08-01T10:00:00.000Z',
    lines: [{ quantity: 2, reasonRaw: 'withdrawal' }],
  });

  beforeAll(async () => {
    harness = await getTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  beforeEach(async () => {
    connectionId = (await createTestConnection(harness.getDataSource(), { name: 'Source A' })).id;
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  /**
   * Seed an ATTRIBUTED return. Attribution is a lookup, never a mint, so the
   * order's identifier mapping must exist BEFORE the observation is ingested —
   * registering it afterwards leaves the row an orphan forever.
   */
  const seedAttributedReturn = async (
    externalOrderId = 'EXT-ORDER-1'
  ): Promise<{ returnId: string; internalOrderId: string }> => {
    const internalOrderId = await harness
      .getApp()
      .get<IIdentifierMappingService>(IDENTIFIER_MAPPING_SERVICE_TOKEN, { strict: false })
      .getOrCreateInternalId(CORE_ENTITY_TYPE.Order, externalOrderId, connectionId);

    const { record } = await returns().upsertFromObservation(
      connectionId,
      observation(externalOrderId)
    );

    return { returnId: record.id, internalOrderId };
  };

  it('should resolve RETURN_REFUND_SERVICE_TOKEN off the booted api graph', () => {
    // The boot-time DI gate. Removing the provider binding from ReturnsModule
    // makes this throw rather than compile-fail — which is why it is asserted.
    expect(refunds()).toBeDefined();
    expect(typeof refunds().triggerRefund).toBe('function');
  });

  it('should trigger an out-of-band refund and settle every line to triggered', async () => {
    const { returnId, internalOrderId } = await seedAttributedReturn();

    const result = await refunds().triggerRefund(returnId, {
      amount: '19.99',
      currency: 'PLN',
      reason: 'withdrawal',
      note: 'buyer withdrew',
    });

    // No adapter implements RefundExecutor, so nothing crossed a boundary and
    // the claim landed on `triggered` directly — never `in_doubt`.
    expect(result.moneyState).toBe('triggered');
    expect(result.claimedLineIds).toHaveLength(1);
    expect(result.refundRecordIntent).toMatchObject({
      returnId,
      internalOrderId,
      executedBy: 'operator_out_of_band',
    });

    const rows: Array<{ moneyState: string }> = await harness
      .getDataSource()
      .query('SELECT "moneyState" FROM return_lines WHERE "returnId" = $1', [returnId]);
    expect(rows.map((row) => row.moneyState)).toEqual(['triggered']);
  });

  it('should refuse a second attempt once the first has been recorded', async () => {
    const { returnId } = await seedAttributedReturn();
    const input = {
      amount: '19.99',
      currency: 'PLN',
      reason: 'withdrawal' as const,
      note: null,
    };

    await refunds().triggerRefund(returnId, input);

    // The conditional UPDATE claims zero rows the second time; the refusal then
    // names WHICH of the three situations this is.
    await expect(refunds().triggerRefund(returnId, input)).rejects.toMatchObject({
      name: 'ReturnRefundBlockedError',
      reason: 'already-attempted',
    });
  });

  it('should persist a RefundRecord linked to the return, carrying executedBy', async () => {
    const { returnId, internalOrderId } = await seedAttributedReturn();

    const { refundRecordIntent } = await refunds().triggerRefund(returnId, {
      amount: '19.99',
      currency: 'PLN',
      reason: 'withdrawal',
      note: null,
    });
    expect(refundRecordIntent).not.toBeNull();

    // The caller performs the write — the #2100 report-don't-persist seam.
    const record = await orderRefunds().recordRefund({
      internalOrderId: refundRecordIntent!.internalOrderId,
      amount: refundRecordIntent!.amount,
      currency: refundRecordIntent!.currency,
      reason: refundRecordIntent!.reason,
      note: refundRecordIntent!.note,
      recordedAt: refundRecordIntent!.recordedAt,
      returnId: refundRecordIntent!.returnId,
      executedBy: refundRecordIntent!.executedBy,
    });

    expect(record.returnId).toBe(returnId);
    expect(record.executedBy).toBe('operator_out_of_band');
    expect(record.internalOrderId).toBe(internalOrderId);

    // And the columns really landed — which also proves the 1859000000000
    // migration's shape against a real database.
    const rows: Array<{ returnId: string | null; executedBy: string }> = await harness
      .getDataSource()
      .query('SELECT "returnId", "executedBy" FROM refund_records WHERE id = $1', [record.id]);
    expect(rows).toEqual([{ returnId, executedBy: 'operator_out_of_band' }]);
  });

  it('should permit a fresh attempt only after a terminal denied observation', async () => {
    const { returnId } = await seedAttributedReturn();
    const input = {
      amount: '19.99',
      currency: 'PLN',
      reason: 'withdrawal' as const,
      note: null,
    };

    await refunds().triggerRefund(returnId, input);
    await refunds().recordRefundObservation(returnId, { observedState: 'denied' });

    // Only a terminal `denied` re-admits — the ADR-042 discipline by name.
    const retried = await refunds().triggerRefund(returnId, input);
    expect(retried.moneyState).toBe('triggered');
  });

  it('should refuse a refunded observation carrying no source instant', async () => {
    const { returnId } = await seedAttributedReturn();

    await expect(
      refunds().recordRefundObservation(returnId, { observedState: 'refunded' })
    ).rejects.toMatchObject({ name: 'ReturnRefundObservationInvalidError' });
  });
});
