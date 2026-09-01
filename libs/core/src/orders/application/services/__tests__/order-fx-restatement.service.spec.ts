/**
 * Order FX Restatement Service Tests (#2468, #2776)
 *
 * @module libs/core/src/orders/application/services
 */
import type { FxStampOutcome } from '../../../domain/types/order-fx-stamp.types';
import type { IOrderFxStampService } from '../../interfaces/order-fx-stamp.service.interface';
import type { OrderRecordRepositoryPort } from '../../../domain/ports/order-record-repository.port';
import type { SalesAnalyticsFilters } from '../../../domain/types/order-sales-analytics.types';
import { OrderFxRestatementService } from '../order-fx-restatement.service';

const SCOPE: SalesAnalyticsFilters = {
  from: new Date('2026-08-01T00:00:00Z'),
  to: new Date('2026-08-27T00:00:00Z'),
};

const STAMPED_OUTCOME: FxStampOutcome = {
  kind: 'stamped',
  reportingCurrency: 'EUR',
  reportingTotalAmount: 12.34,
  exchangeRateId: 'rate-1',
  alreadyStamped: false,
};

describe('OrderFxRestatementService', () => {
  let repository: jest.Mocked<
    Pick<
      OrderRecordRepositoryPort,
      | 'findCurrencyMismatchOrderRefsAfter'
      | 'clearFxStampForRestatement'
      | 'countRemainingCurrencyMismatch'
    >
  >;
  let stampService: jest.Mocked<IOrderFxStampService>;
  let service: OrderFxRestatementService;

  beforeEach(() => {
    repository = {
      findCurrencyMismatchOrderRefsAfter: jest.fn().mockResolvedValue([]),
      clearFxStampForRestatement: jest.fn().mockResolvedValue(true),
      countRemainingCurrencyMismatch: jest
        .fn()
        .mockResolvedValue({ total: 0, terminalMarked: 0, pending: 0 }),
    };
    stampService = {
      stamp: jest.fn().mockResolvedValue(STAMPED_OUTCOME),
      sweep: jest.fn(),
    };
    service = new OrderFxRestatementService(
      repository as unknown as OrderRecordRepositoryPort,
      stampService
    );
  });

  function seed(ids: string[]): void {
    repository.findCurrencyMismatchOrderRefsAfter.mockResolvedValue(
      ids.map((internalOrderId) => ({ internalOrderId, sourceConnectionId: 'conn-1' }))
    );
  }

  it('should not enqueue any job during a restatement page', async () => {
    seed(['ol_order_a']);

    await service.restatePage(SCOPE, 'EUR', { runId: 'run-1', afterOrderId: null, limit: 10 });

    // No JobEnqueuePort is even injected any more — the assertion that matters
    // is that the only downstream call is the direct, in-process stamp.
    expect(stampService.stamp).toHaveBeenCalledWith('ol_order_a');
  });

  it('should clear an order stamp BEFORE stamping it', async () => {
    // Reversed, `stamp()` would re-observe the still-present stale figure and
    // short-circuit via its own already-stamped branch — the original
    // live-demo bug ("we re-enqueued and nothing changed").
    const order: string[] = [];
    repository.clearFxStampForRestatement.mockImplementation(() => {
      order.push('clear');
      return Promise.resolve(true);
    });
    stampService.stamp.mockImplementation(() => {
      order.push('stamp');
      return Promise.resolve(STAMPED_OUTCOME);
    });
    seed(['ol_order_a']);

    await service.restatePage(SCOPE, 'EUR', { runId: 'run-1', afterOrderId: null, limit: 10 });

    expect(order).toEqual(['clear', 'stamp']);
  });

  it('should stamp every ref in the page, sequentially', async () => {
    repository.findCurrencyMismatchOrderRefsAfter.mockResolvedValue([
      { internalOrderId: 'ol_order_a', sourceConnectionId: 'conn-a' },
      { internalOrderId: 'ol_order_b', sourceConnectionId: 'conn-b' },
    ]);

    await service.restatePage(SCOPE, 'EUR', { runId: 'run-1', afterOrderId: null, limit: 10 });

    expect(stampService.stamp.mock.calls.map(([id]) => id)).toEqual(['ol_order_a', 'ol_order_b']);
  });

  it('should return the last id as the cursor on a full page and null on a short one', async () => {
    seed(['ol_order_a', 'ol_order_b']);
    await expect(
      service.restatePage(SCOPE, 'EUR', { runId: 'run-1', afterOrderId: null, limit: 2 })
    ).resolves.toMatchObject({ scanned: 2, nextCursor: 'ol_order_b' });

    seed(['ol_order_c']);
    await expect(
      service.restatePage(SCOPE, 'EUR', { runId: 'run-1', afterOrderId: 'ol_order_b', limit: 2 })
    ).resolves.toMatchObject({ scanned: 1, nextCursor: null });
  });

  it('should pass the keyset lower bound through so the enumeration can never re-read a cleared page', async () => {
    seed([]);

    await service.restatePage(SCOPE, 'EUR', {
      runId: 'run-1',
      afterOrderId: 'ol_order_b',
      limit: 5,
    });

    expect(repository.findCurrencyMismatchOrderRefsAfter).toHaveBeenCalledWith(SCOPE, 'EUR', {
      afterOrderId: 'ol_order_b',
      limit: 5,
    });
  });

  it('should not count a never-stamped order as cleared, but still stamp it', async () => {
    // A never-stamped order is in the mismatch population too; the guarded
    // clear reports false for it and stamping still proceeds.
    repository.clearFxStampForRestatement.mockResolvedValue(false);
    seed(['ol_order_a']);

    await expect(
      service.restatePage(SCOPE, 'EUR', { runId: 'run-1', afterOrderId: null, limit: 10 })
    ).resolves.toMatchObject({ cleared: 0, stamped: 1 });
  });

  it('should keep going when one order fails to clear, so a single bad row cannot abort the repair', async () => {
    repository.clearFxStampForRestatement
      .mockRejectedValueOnce(new Error('deadlock detected'))
      .mockResolvedValue(true);
    seed(['ol_order_a', 'ol_order_b']);

    const result = await service.restatePage(SCOPE, 'EUR', {
      runId: 'run-1',
      afterOrderId: null,
      limit: 10,
    });

    expect(result).toMatchObject({ scanned: 2, cleared: 1, stamped: 2 });
  });

  it('should keep going, and still stamp the remainder, when one order`s clear throws', async () => {
    // `clearOne` swallows its own throw and reports `false`; the loop must
    // still reach `stamp()` for that same order and for every order after it.
    repository.clearFxStampForRestatement
      .mockRejectedValueOnce(new Error('deadlock detected'))
      .mockResolvedValue(true);
    seed(['ol_order_a', 'ol_order_b']);

    await service.restatePage(SCOPE, 'EUR', { runId: 'run-1', afterOrderId: null, limit: 10 });

    expect(stampService.stamp.mock.calls.map(([id]) => id)).toEqual(['ol_order_a', 'ol_order_b']);
  });

  it('should tally terminal and deferred stamp outcomes separately from stamped', async () => {
    stampService.stamp
      .mockResolvedValueOnce({ kind: 'terminal', reason: 'no-native-total' })
      .mockResolvedValueOnce({ kind: 'deferred', reason: 'provider down', retryEnqueued: true })
      .mockResolvedValueOnce(STAMPED_OUTCOME);
    seed(['ol_order_a', 'ol_order_b', 'ol_order_c']);

    await expect(
      service.restatePage(SCOPE, 'EUR', { runId: 'run-1', afterOrderId: null, limit: 10 })
    ).resolves.toMatchObject({ scanned: 3, stamped: 1, terminal: 1, deferred: 1 });
  });

  it('should not count an already-stamped outcome as a fresh stamp', async () => {
    stampService.stamp.mockResolvedValue({ ...STAMPED_OUTCOME, alreadyStamped: true });
    seed(['ol_order_a']);

    await expect(
      service.restatePage(SCOPE, 'EUR', { runId: 'run-1', afterOrderId: null, limit: 10 })
    ).resolves.toMatchObject({ stamped: 0 });
  });

  it('should delegate the remaining-population read straight through', async () => {
    repository.countRemainingCurrencyMismatch.mockResolvedValue({
      total: 3,
      terminalMarked: 2,
      pending: 1,
    });

    await expect(service.countRemaining(SCOPE, 'EUR')).resolves.toEqual({
      total: 3,
      terminalMarked: 2,
      pending: 1,
    });
  });
});
