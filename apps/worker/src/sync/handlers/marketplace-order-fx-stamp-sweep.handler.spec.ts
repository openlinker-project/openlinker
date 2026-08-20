/**
 * Unit tests for `MarketplaceOrderFxStampSweepHandler` (#2125).
 *
 * Focused on the two window bounds the handler derives, since the core sweep
 * takes both as instants and cannot re-derive either: `createdSince` (how far
 * back the frontier reaches) and `terminalRetryBefore` (how long a terminal
 * answer is honoured before the order gets one more attempt - #2135 review,
 * finding 1, the only recovery path a terminal answer has).
 *
 * @module apps/worker/src/sync/handlers
 */
import type { IOrderFxStampService, OrderFxSweepResult } from '@openlinker/core/orders';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import type { SyncJob } from '@openlinker/core/sync';
import { MarketplaceOrderFxStampSweepHandler } from './marketplace-order-fx-stamp-sweep.handler';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-08-19T12:00:00.000Z');

function makeJob(payload: unknown): SyncJob {
  return {
    id: 'job-1',
    jobType: 'marketplace.order.fxStampSweep',
    connectionId: 'conn-1',
    payload,
    idempotencyKey: 'marketplace:conn-1:order:fxStampSweep:123',
    status: 'running',
    attempts: 1,
    maxAttempts: 10,
    nextRunAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  } as SyncJob;
}

const EMPTY_RESULT: OrderFxSweepResult = { scanned: 0, stamped: 0, terminal: 0, deferred: 0 };

describe('MarketplaceOrderFxStampSweepHandler', () => {
  let fxStamp: jest.Mocked<IOrderFxStampService>;
  let handler: MarketplaceOrderFxStampSweepHandler;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    fxStamp = {
      stamp: jest.fn(),
      sweep: jest.fn().mockResolvedValue(EMPTY_RESULT),
    } as unknown as jest.Mocked<IOrderFxStampService>;
    handler = new MarketplaceOrderFxStampSweepHandler(fxStamp);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should derive both window bounds from the payload and delegate with job.connectionId', async () => {
    const result = await handler.execute(
      makeJob({ schemaVersion: 1, limit: 50, maxAgeDays: 10, terminalRetryDays: 2 })
    );

    expect(result).toEqual({ outcome: 'ok' });
    expect(fxStamp.sweep).toHaveBeenCalledWith('conn-1', {
      limit: 50,
      createdSince: new Date(NOW.getTime() - 10 * MS_PER_DAY),
      terminalRetryBefore: new Date(NOW.getTime() - 2 * MS_PER_DAY),
    });
  });

  it.each([
    ['an absent value', undefined],
    ['a non-numeric value', 'seven'],
    ['zero', 0],
    ['a negative value', -3],
  ])('should default the terminal-retry cooldown to 7 days on %s', async (_label, value) => {
    // The default matters: without a cooldown a terminal answer is permanent, so
    // an order refused by a throttled provider (or by a host booted without
    // FxIntegrationModule) never receives a reported figure at all.
    await handler.execute(makeJob({ schemaVersion: 1, limit: 50, terminalRetryDays: value }));

    expect(fxStamp.sweep).toHaveBeenCalledWith(
      'conn-1',
      expect.objectContaining({
        terminalRetryBefore: new Date(NOW.getTime() - 7 * MS_PER_DAY),
      })
    );
  });

  it('should clamp an over-wide cooldown to the 365-day ceiling', async () => {
    await handler.execute(makeJob({ schemaVersion: 1, terminalRetryDays: 5000 }));

    expect(fxStamp.sweep).toHaveBeenCalledWith(
      'conn-1',
      expect.objectContaining({
        terminalRetryBefore: new Date(NOW.getTime() - 365 * MS_PER_DAY),
      })
    );
  });

  it('should reject a payload without schemaVersion 1 rather than sweeping on a guess', async () => {
    await expect(handler.execute(makeJob({ schemaVersion: 2 }))).rejects.toThrow(
      SyncJobExecutionError
    );
    expect(fxStamp.sweep).not.toHaveBeenCalled();
  });

  it('should wrap a sweep failure as a retryable SyncJobExecutionError', async () => {
    // Only a failure of the sweep ITSELF escapes - individual orders carry their
    // own terminal/deferred answers and never fail the tick.
    fxStamp.sweep.mockRejectedValue(new Error('page read failed'));

    await expect(handler.execute(makeJob({ schemaVersion: 1 }))).rejects.toThrow(
      SyncJobExecutionError
    );
  });
});
