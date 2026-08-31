/**
 * Returns Handler Tests (#2330, #2332)
 *
 * The three handlers are thin by design, so these tests assert exactly the
 * things a thin delegate can still get wrong: payload coercion, the terminal-vs-
 * retryable split on the child, and the scan-offset dance on the sweep.
 *
 * @module apps/worker/src/sync/handlers/__tests__
 */
import { MarketplaceReturnsPollHandler } from '../marketplace-returns-poll.handler';
import { MarketplaceReturnSyncHandler } from '../marketplace-return-sync.handler';
import { MarketplaceReturnsStatusSyncHandler } from '../marketplace-returns-status-sync.handler';
import { ReturnsOrphanReconcileHandler } from '../returns-orphan-reconcile.handler';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import {
  ReturnObservationMissingExternalIdError,
  ReturnSourceNotReadableError,
} from '@openlinker/core/returns';
import type { SyncJob } from '@openlinker/core/sync';

const connectionId = 'conn-1';

function job(jobType: string, payload: unknown): SyncJob {
  return { id: 'job-1', jobType, connectionId, payload } as unknown as SyncJob;
}

describe('MarketplaceReturnsPollHandler', () => {
  let ingestion: { ingestReturns: jest.Mock; syncReturnFromSource: jest.Mock };
  let handler: MarketplaceReturnsPollHandler;

  beforeEach(() => {
    ingestion = {
      ingestReturns: jest.fn().mockResolvedValue({
        fetched: 2,
        enqueued: 2,
        nextCursor: 'r-2',
        committed: true,
        skippedDueToLock: false,
        droppedWithoutId: 0,
      }),
      syncReturnFromSource: jest.fn(),
    };
    handler = new MarketplaceReturnsPollHandler(ingestion as never);
  });

  it('should pass the payload through and report ok', async () => {
    const result = await handler.execute(
      job('marketplace.returns.poll', { schemaVersion: 1, cursorKey: 'k', limit: 25 })
    );

    expect(ingestion.ingestReturns).toHaveBeenCalledWith(connectionId, {
      cursorKey: 'k',
      limit: 25,
    });
    expect(result).toEqual({ outcome: 'ok' });
  });

  it('should default the cursor key and limit when the payload omits them', async () => {
    await handler.execute(job('marketplace.returns.poll', { schemaVersion: 1 }));

    expect(ingestion.ingestReturns).toHaveBeenCalledWith(connectionId, {
      cursorKey: 'allegro.customerReturns.lastReturnId',
      limit: 100,
    });
  });

  it('should treat a lock skip as a success, not a retry', async () => {
    ingestion.ingestReturns.mockResolvedValue({
      fetched: 0,
      enqueued: 0,
      nextCursor: null,
      committed: false,
      skippedDueToLock: true,
      droppedWithoutId: 0,
    });

    expect(await handler.execute(job('marketplace.returns.poll', { schemaVersion: 1 }))).toEqual({
      outcome: 'ok',
    });
  });

  it('should wrap a core failure as a retryable SyncJobExecutionError', async () => {
    ingestion.ingestReturns.mockRejectedValue(new Error('stream unavailable'));

    await expect(
      handler.execute(job('marketplace.returns.poll', { schemaVersion: 1 }))
    ).rejects.toBeInstanceOf(SyncJobExecutionError);
  });

  it('should reject a missing payload', async () => {
    await expect(
      handler.execute(job('marketplace.returns.poll', null))
    ).rejects.toBeInstanceOf(SyncJobExecutionError);
  });
});

describe('MarketplaceReturnSyncHandler', () => {
  let ingestion: { ingestReturns: jest.Mock; syncReturnFromSource: jest.Mock };
  let handler: MarketplaceReturnSyncHandler;

  beforeEach(() => {
    ingestion = {
      ingestReturns: jest.fn(),
      syncReturnFromSource: jest
        .fn()
        .mockResolvedValue({ returnId: 'ol_return_1', attributed: true }),
    };
    handler = new MarketplaceReturnSyncHandler(ingestion as never);
  });

  it('should hydrate the named return and report ok', async () => {
    const result = await handler.execute(
      job('marketplace.return.sync', { schemaVersion: 1, externalReturnId: 'r-1' })
    );

    expect(ingestion.syncReturnFromSource).toHaveBeenCalledWith(connectionId, 'r-1');
    expect(result).toEqual({ outcome: 'ok' });
  });

  it('should report a TERMINAL business_failure for an unkeyed observation', async () => {
    // No number of retries makes a missing source id appear, and core refuses
    // to invent one — so retrying would burn the ladder and leave a dead row.
    ingestion.syncReturnFromSource.mockRejectedValue(
      new ReturnObservationMissingExternalIdError(connectionId, 'order-1')
    );

    const result = await handler.execute(
      job('marketplace.return.sync', { schemaVersion: 1, externalReturnId: 'r-1' })
    );

    expect(result).toEqual({ outcome: 'business_failure' });
  });

  it('should report a TERMINAL business_failure when the connection cannot read returns (#2400)', async () => {
    // The `marketplace.return.sync` gate is `OrderSource` — correctly, since
    // `ReturnSourceReader` is guard-only and `enabledCapabilities` can never
    // carry it (#2085). That makes the gate over-permissive the OTHER way: a
    // plain `OrderSource` connection with no return reader passes it and then
    // fails at the narrow. Reachable from the poll fan-out and, since #2400,
    // from an inbound `'return'` webhook. Retrying cannot make an adapter grow
    // a capability, so this must not spend the ladder and a dead row.
    ingestion.syncReturnFromSource.mockRejectedValue(
      new ReturnSourceNotReadableError(connectionId, 'r-1')
    );

    const result = await handler.execute(
      job('marketplace.return.sync', { schemaVersion: 1, externalReturnId: 'r-1' })
    );

    expect(result).toEqual({ outcome: 'business_failure' });
  });

  it('should wrap any other failure as retryable', async () => {
    ingestion.syncReturnFromSource.mockRejectedValue(new Error('502 from source'));

    await expect(
      handler.execute(job('marketplace.return.sync', { schemaVersion: 1, externalReturnId: 'r-1' }))
    ).rejects.toBeInstanceOf(SyncJobExecutionError);
  });

  it('should reject a payload without an externalReturnId', async () => {
    await expect(
      handler.execute(job('marketplace.return.sync', { schemaVersion: 1 }))
    ).rejects.toBeInstanceOf(SyncJobExecutionError);
  });
});

describe('MarketplaceReturnsStatusSyncHandler', () => {
  let statusSync: { sync: jest.Mock };
  let cursors: { get: jest.Mock; set: jest.Mock };
  let handler: MarketplaceReturnsStatusSyncHandler;

  beforeEach(() => {
    statusSync = {
      sync: jest.fn().mockResolvedValue({
        scanned: 2,
        updated: 2,
        attributed: 2,
        orphaned: 0,
        notFound: 0,
        failed: 0,
        total: 10,
        nextOffset: 4,
        terminalVocabularyDeclared: true,
      }),
    };
    cursors = { get: jest.fn().mockResolvedValue('2'), set: jest.fn() };
    handler = new MarketplaceReturnsStatusSyncHandler(statusSync as never, cursors as never);
  });

  it('should read the stored offset, sweep, then persist the next one', async () => {
    const result = await handler.execute(
      job('marketplace.returns.statusSync', { schemaVersion: 1, limit: 2, lookbackDays: 90 })
    );

    expect(cursors.get).toHaveBeenCalledWith(connectionId, 'allegro.customerReturns.scanOffset');
    expect(statusSync.sync).toHaveBeenCalledWith(connectionId, {
      limit: 2,
      offset: 2,
      lookbackDays: 90,
    });
    expect(cursors.set).toHaveBeenCalledWith(
      connectionId,
      'allegro.customerReturns.scanOffset',
      '4'
    );
    expect(result).toEqual({ outcome: 'ok' });
  });

  it('should honour a payload-supplied cursor key', async () => {
    await handler.execute(
      job('marketplace.returns.statusSync', { schemaVersion: 1, limit: 2, cursorKey: 'custom.key' })
    );

    expect(cursors.get).toHaveBeenCalledWith(connectionId, 'custom.key');
    expect(cursors.set).toHaveBeenCalledWith(connectionId, 'custom.key', '4');
  });

  it.each([
    [null, 0],
    ['not-a-number', 0],
    ['-5', 0],
    ['12', 12],
  ])('should parse a stored offset of %s as %s', async (stored, expected) => {
    cursors.get.mockResolvedValue(stored);

    await handler.execute(job('marketplace.returns.statusSync', { schemaVersion: 1, limit: 2 }));

    expect(statusSync.sync).toHaveBeenCalledWith(
      connectionId,
      expect.objectContaining({ offset: expected })
    );
  });

  it('should default the limit and the age bound', async () => {
    await handler.execute(job('marketplace.returns.statusSync', { schemaVersion: 1 }));

    expect(statusSync.sync).toHaveBeenCalledWith(
      connectionId,
      expect.objectContaining({ limit: 50, lookbackDays: 90 })
    );
  });

  it('should NOT persist an offset when the sweep threw', async () => {
    statusSync.sync.mockRejectedValue(new Error('source down'));

    await expect(
      handler.execute(job('marketplace.returns.statusSync', { schemaVersion: 1, limit: 2 }))
    ).rejects.toBeInstanceOf(SyncJobExecutionError);
    expect(cursors.set).not.toHaveBeenCalled();
  });
});

describe('ReturnsOrphanReconcileHandler', () => {
  let reattribution: { reconcile: jest.Mock };
  let cursors: { get: jest.Mock; set: jest.Mock };
  let handler: ReturnsOrphanReconcileHandler;

  beforeEach(() => {
    reattribution = {
      reconcile: jest.fn().mockResolvedValue({
        scanned: 5,
        reattributed: 2,
        alreadyAttributed: 1,
        unresolved: 2,
        failed: 0,
        nextOffset: 25,
        total: 100,
      }),
    };
    cursors = { get: jest.fn().mockResolvedValue('20'), set: jest.fn() };
    handler = new ReturnsOrphanReconcileHandler(reattribution as never, cursors as never);
  });

  it('should read the stored scan offset and pass it to the pass', async () => {
    await handler.execute(job('returns.orphan.reconcile', { schemaVersion: 1, limit: 5 }));

    expect(cursors.get).toHaveBeenCalledWith(connectionId, 'returns.orphanReattribution.scanOffset');
    expect(reattribution.reconcile).toHaveBeenCalledWith(connectionId, { limit: 5, offset: 20 });
  });

  it('should default the page size and cursor key when the payload omits them', async () => {
    cursors.get.mockResolvedValue(null);

    await handler.execute(job('returns.orphan.reconcile', { schemaVersion: 1 }));

    expect(reattribution.reconcile).toHaveBeenCalledWith(connectionId, { limit: 100, offset: 0 });
  });

  it('should honour an explicit cursor key', async () => {
    await handler.execute(
      job('returns.orphan.reconcile', { schemaVersion: 1, cursorKey: 'custom.offset' })
    );

    expect(cursors.get).toHaveBeenCalledWith(connectionId, 'custom.offset');
  });

  it('should persist the next offset after a successful run', async () => {
    await handler.execute(job('returns.orphan.reconcile', { schemaVersion: 1 }));

    expect(cursors.set).toHaveBeenCalledWith(
      connectionId,
      'returns.orphanReattribution.scanOffset',
      '25'
    );
  });

  it('should leave the stored offset untouched when the pass throws', async () => {
    reattribution.reconcile.mockRejectedValue(new Error('ConnectionNotFound'));

    // A failed page must be retried, never silently stepped over.
    await expect(
      handler.execute(job('returns.orphan.reconcile', { schemaVersion: 1 }))
    ).rejects.toBeInstanceOf(SyncJobExecutionError);
    expect(cursors.set).not.toHaveBeenCalled();
  });

  it('should reject a job with no payload', async () => {
    await expect(
      handler.execute(job('returns.orphan.reconcile', null))
    ).rejects.toBeInstanceOf(SyncJobExecutionError);
  });
});
