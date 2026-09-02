/**
 * Return Ingestion Service Tests (#2330)
 *
 * The headline assertion is the first one in the `ingestReturns` block: a failed
 * child enqueue must NEVER advance the cursor. Everything else in this file
 * exists to stop that guarantee being eroded by a change made for another
 * reason.
 *
 * @module libs/core/src/returns/application/services/__tests__
 */
import { ReturnIngestionService } from '../return-ingestion.service';
import type { IReturnsService } from '../returns.service.interface';
import type { IncomingReturn } from '../../../domain/types/incoming-return.types';
import type { ReturnFeedOutput } from '../../../domain/types/return-feed.types';

type Mocked<T> = { [K in keyof T]: jest.Mock };

const connectionId = 'conn-1';
const cursorKey = 'allegro.customerReturns.lastReturnId';

function feedItem(id: string) {
  return {
    externalReturnId: id,
    externalOrderId: `order-${id}`,
    occurredAt: '2026-01-11T09:36:57.000Z',
    eventKey: id,
  };
}

function observation(overrides: Partial<IncomingReturn> = {}): IncomingReturn {
  return {
    externalReturnId: 'r-1',
    externalOrderId: 'order-r-1',
    rawStatus: 'DELIVERED',
    createdAt: '2026-01-11T09:36:57.000Z',
    lines: [],
    ...overrides,
  };
}

describe('ReturnIngestionService', () => {
  let service: ReturnIngestionService;
  let integrations: { getCapabilityAdapter: jest.Mock };
  let syncCursors: { getCursor: jest.Mock; advanceCursor: jest.Mock };
  let jobQueue: { enqueueBulk: jest.Mock; enqueue: jest.Mock };
  let lock: { acquire: jest.Mock; release: jest.Mock };
  let returnsService: Mocked<IReturnsService>;
  let reader: { listReturnFeed: jest.Mock; getReturn: jest.Mock };

  beforeEach(() => {
    reader = {
      listReturnFeed: jest.fn(),
      getReturn: jest.fn(),
    };
    integrations = { getCapabilityAdapter: jest.fn().mockResolvedValue(reader) };
    syncCursors = { getCursor: jest.fn().mockResolvedValue(null), advanceCursor: jest.fn() };
    jobQueue = { enqueueBulk: jest.fn().mockResolvedValue(undefined), enqueue: jest.fn() };
    lock = { acquire: jest.fn().mockResolvedValue('token-1'), release: jest.fn() };
    returnsService = {
      upsertFromObservation: jest.fn(),
      getReturn: jest.fn(),
      listOrphanReturns: jest.fn(),
    } as unknown as Mocked<IReturnsService>;

    service = new ReturnIngestionService(
      integrations as never,
      syncCursors as never,
      jobQueue as never,
      lock as never,
      returnsService as never
    );
  });

  describe('ingestReturns — cursor safety', () => {
    it('should NOT advance the cursor when enqueueing the children fails', async () => {
      syncCursors.getCursor.mockResolvedValue('r-0');
      reader.listReturnFeed.mockResolvedValue({
        items: [feedItem('r-1'), feedItem('r-2'), feedItem('r-3')],
        nextCursor: 'r-3',
      } satisfies ReturnFeedOutput);
      jobQueue.enqueueBulk.mockRejectedValue(new Error('stream unavailable'));

      await expect(service.ingestReturns(connectionId, { cursorKey, limit: 100 })).rejects.toThrow(
        'stream unavailable'
      );

      expect(syncCursors.advanceCursor).not.toHaveBeenCalled();
      // And the lock is still released, so the next tick can retry the page.
      expect(lock.release).toHaveBeenCalledWith(`marketplace:returns:poll:${connectionId}`, 'token-1');
    });

    it('should advance the cursor exactly once after every enqueue succeeded', async () => {
      syncCursors.getCursor.mockResolvedValue('r-0');
      reader.listReturnFeed.mockResolvedValue({
        items: [feedItem('r-1'), feedItem('r-2')],
        nextCursor: 'r-2',
      });

      const result = await service.ingestReturns(connectionId, { cursorKey, limit: 100 });

      expect(jobQueue.enqueueBulk).toHaveBeenCalledTimes(1);
      expect(syncCursors.advanceCursor).toHaveBeenCalledTimes(1);
      expect(syncCursors.advanceCursor).toHaveBeenCalledWith(connectionId, cursorKey, 'r-2');
      expect(result).toMatchObject({ fetched: 2, enqueued: 2, committed: true, nextCursor: 'r-2' });
    });

    it('should hold the cursor when the source reports null', async () => {
      syncCursors.getCursor.mockResolvedValue('r-0');
      reader.listReturnFeed.mockResolvedValue({ items: [], nextCursor: null });

      const result = await service.ingestReturns(connectionId, { cursorKey, limit: 100 });

      expect(syncCursors.advanceCursor).not.toHaveBeenCalled();
      expect(result.committed).toBe(false);
    });

    it('should hold the cursor when the source echoes it back unchanged', async () => {
      syncCursors.getCursor.mockResolvedValue('r-7');
      reader.listReturnFeed.mockResolvedValue({ items: [], nextCursor: 'r-7' });

      const result = await service.ingestReturns(connectionId, { cursorKey, limit: 100 });

      expect(syncCursors.advanceCursor).not.toHaveBeenCalled();
      expect(result.committed).toBe(false);
    });

    it('should hold the cursor when the source reports a blank string', async () => {
      syncCursors.getCursor.mockResolvedValue('r-7');
      reader.listReturnFeed.mockResolvedValue({ items: [], nextCursor: '   ' });

      expect((await service.ingestReturns(connectionId, { cursorKey, limit: 100 })).committed).toBe(
        false
      );
      expect(syncCursors.advanceCursor).not.toHaveBeenCalled();
    });

    it('should commit a UUID cursor that sorts BELOW the previous one', async () => {
      // The regression guard `OrderIngestionService` carries would coerce both
      // to NaN and fall through to a lexicographic compare, refusing this
      // perfectly legitimate advance and wedging the connection. Not porting it
      // is the whole point — this test is the tripwire.
      syncCursors.getCursor.mockResolvedValue('ffffffff-0000-0000-0000-000000000000');
      reader.listReturnFeed.mockResolvedValue({
        items: [feedItem('00000000-1111-2222-3333-444444444444')],
        nextCursor: '00000000-1111-2222-3333-444444444444',
      });

      const result = await service.ingestReturns(connectionId, { cursorKey, limit: 100 });

      expect(result.committed).toBe(true);
      expect(syncCursors.advanceCursor).toHaveBeenCalledWith(
        connectionId,
        cursorKey,
        '00000000-1111-2222-3333-444444444444'
      );
    });
  });

  describe('ingestReturns — fan-out', () => {
    it('should enqueue one connection-scoped, return-keyed child per item', async () => {
      reader.listReturnFeed.mockResolvedValue({
        items: [feedItem('r-1')],
        nextCursor: 'r-1',
      });

      await service.ingestReturns(connectionId, { cursorKey, limit: 100 });

      expect(jobQueue.enqueueBulk).toHaveBeenCalledWith([
        {
          type: 'marketplace.return.sync',
          connectionId,
          payload: {
            schemaVersion: 1,
            externalReturnId: 'r-1',
            eventKey: 'r-1',
            occurredAt: '2026-01-11T09:36:57.000Z',
          },
          options: { dedupeKey: `marketplace:${connectionId}:return:r-1` },
        },
      ]);
    });

    it('should not call enqueueBulk at all for an empty page', async () => {
      reader.listReturnFeed.mockResolvedValue({ items: [], nextCursor: null });

      await service.ingestReturns(connectionId, { cursorKey, limit: 100 });

      expect(jobQueue.enqueueBulk).not.toHaveBeenCalled();
    });

    it('should count and drop an item the source left unnamed, and still commit', async () => {
      reader.listReturnFeed.mockResolvedValue({
        items: [feedItem('r-1'), { ...feedItem('r-2'), externalReturnId: '  ' }],
        nextCursor: 'r-2',
      });

      const result = await service.ingestReturns(connectionId, { cursorKey, limit: 100 });

      expect(result).toMatchObject({ fetched: 2, enqueued: 1, droppedWithoutId: 1, committed: true });
    });
  });

  describe('ingestReturns — degradation', () => {
    it('should stand down without touching the source when the lock is held', async () => {
      lock.acquire.mockResolvedValue(null);

      const result = await service.ingestReturns(connectionId, { cursorKey, limit: 100 });

      expect(result).toMatchObject({ skippedDueToLock: true, fetched: 0, committed: false });
      expect(integrations.getCapabilityAdapter).not.toHaveBeenCalled();
      expect(lock.release).not.toHaveBeenCalled();
    });

    it('should return a zero result — never throw — when the adapter cannot read returns', async () => {
      integrations.getCapabilityAdapter.mockResolvedValue({ listOrderFeed: jest.fn() });

      const result = await service.ingestReturns(connectionId, { cursorKey, limit: 100 });

      expect(result).toMatchObject({ fetched: 0, enqueued: 0, committed: false, skippedDueToLock: false });
      expect(syncCursors.advanceCursor).not.toHaveBeenCalled();
      expect(lock.release).toHaveBeenCalled();
    });

    it('should return a zero result when no OrderSource adapter resolves at all', async () => {
      integrations.getCapabilityAdapter.mockRejectedValue(new Error('connection disabled'));

      const result = await service.ingestReturns(connectionId, { cursorKey, limit: 100 });

      expect(result.fetched).toBe(0);
      expect(result.committed).toBe(false);
    });

    it('should resolve OrderSource — never the advertised-without-dispatch name', async () => {
      reader.listReturnFeed.mockResolvedValue({ items: [], nextCursor: null });

      await service.ingestReturns(connectionId, { cursorKey, limit: 100 });

      expect(integrations.getCapabilityAdapter).toHaveBeenCalledWith(connectionId, 'OrderSource');
    });
  });

  describe('syncReturnFromSource', () => {
    it('should hydrate through the source and persist through the returns service', async () => {
      reader.getReturn.mockResolvedValue(observation());
      returnsService.upsertFromObservation.mockResolvedValue({
        record: { id: 'ol_return_1' },
        attributed: true,
      });

      const result = await service.syncReturnFromSource(connectionId, 'r-1');

      expect(reader.getReturn).toHaveBeenCalledWith({ externalReturnId: 'r-1' });
      expect(returnsService.upsertFromObservation).toHaveBeenCalledWith(
        connectionId,
        observation()
      );
      expect(result).toEqual({ returnId: 'ol_return_1', attributed: true });
    });

    it('should report a call that could not name the order as unattributed', async () => {
      reader.getReturn.mockResolvedValue(observation({ externalOrderId: null }));
      returnsService.upsertFromObservation.mockResolvedValue({
        record: { id: 'ol_return_2' },
        attributed: false,
      });

      expect((await service.syncReturnFromSource(connectionId, 'r-2')).attributed).toBe(false);
    });

    it('should throw when the connection cannot read returns — the child has nothing to do', async () => {
      integrations.getCapabilityAdapter.mockResolvedValue({ listOrderFeed: jest.fn() });

      await expect(service.syncReturnFromSource(connectionId, 'r-1')).rejects.toThrow(
        /does not support reading returns/
      );
    });
  });
});
