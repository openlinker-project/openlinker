/**
 * Return Status Sync Service Tests (#2330)
 *
 * Pass 2 — the bounded re-read. The assertions worth defending are the three
 * bounds (declared terminal vocabulary, age, page budget), the 404 tolerance
 * that keeps a page going, and the offset arithmetic that advances by rows READ
 * rather than rows successfully persisted.
 *
 * @module libs/core/src/returns/application/services/__tests__
 */
import { ReturnStatusSyncService } from '../return-status-sync.service';
import type { IncomingReturn } from '../../../domain/types/incoming-return.types';
import type { ReturnSourceSweepFilter } from '../../../domain/types/return-sweep.types';

const connectionId = 'conn-1';

function candidate(id: string, rawStatus = 'DELIVERED') {
  return { id: `ol_return_${id}`, externalReturnId: id, rawStatus };
}

function observation(id: string): IncomingReturn {
  return {
    externalReturnId: id,
    externalOrderId: `order-${id}`,
    rawStatus: 'FINISHED',
    createdAt: '2026-01-11T09:36:57.000Z',
    lines: [],
  };
}

describe('ReturnStatusSyncService', () => {
  let service: ReturnStatusSyncService;
  let integrations: { getCapabilityAdapter: jest.Mock };
  let repository: { findForSourceSweep: jest.Mock; countForSourceSweep: jest.Mock };
  let returnsService: { upsertFromObservation: jest.Mock };
  let reader: {
    listReturnFeed: jest.Mock;
    getReturn: jest.Mock;
    terminalRawStatuses?: readonly string[];
  };

  beforeEach(() => {
    reader = {
      listReturnFeed: jest.fn(),
      getReturn: jest.fn(),
      terminalRawStatuses: ['FINISHED', 'REJECTED'],
    };
    integrations = { getCapabilityAdapter: jest.fn().mockResolvedValue(reader) };
    repository = {
      findForSourceSweep: jest.fn().mockResolvedValue([]),
      countForSourceSweep: jest.fn().mockResolvedValue(0),
    };
    returnsService = {
      upsertFromObservation: jest
        .fn()
        .mockResolvedValue({ record: { id: 'ol_return_x' }, attributed: true }),
    };

    service = new ReturnStatusSyncService(
      integrations as never,
      repository as never,
      returnsService as never
    );
  });

  function lastFilter(): ReturnSourceSweepFilter {
    const calls = repository.countForSourceSweep.mock.calls as unknown[][];
    return calls[0][0] as ReturnSourceSweepFilter;
  }

  describe('candidate filter', () => {
    it('should pass the adapter-declared terminal vocabulary through opaquely', async () => {
      repository.countForSourceSweep.mockResolvedValue(1);
      repository.findForSourceSweep.mockResolvedValue([candidate('r-1')]);
      reader.getReturn.mockResolvedValue(observation('r-1'));

      await service.sync(connectionId, { limit: 10 });

      expect(lastFilter().terminalRawStatuses).toEqual(['FINISHED', 'REJECTED']);
    });

    it('should scope to this connection and to source_ingested rows only', async () => {
      await service.sync(connectionId, { limit: 10 });

      expect(lastFilter()).toMatchObject({
        sourceConnectionId: connectionId,
        origin: 'source_ingested',
      });
    });

    it('should apply the default 90-day age bound when the payload names none', async () => {
      await service.sync(connectionId, { limit: 10 });

      const expected = Date.now() - 90 * 24 * 60 * 60 * 1000;
      expect(Math.abs(lastFilter().openedSince.getTime() - expected)).toBeLessThan(60_000);
    });

    it('should honour an explicit lookback, and reject a nonsensical one', async () => {
      await service.sync(connectionId, { limit: 10, lookbackDays: 7 });
      const sevenDays = Date.now() - 7 * 24 * 60 * 60 * 1000;
      expect(Math.abs(lastFilter().openedSince.getTime() - sevenDays)).toBeLessThan(60_000);

      repository.countForSourceSweep.mockClear();
      await service.sync(connectionId, { limit: 10, lookbackDays: 0 });
      const ninetyDays = Date.now() - 90 * 24 * 60 * 60 * 1000;
      expect(Math.abs(lastFilter().openedSince.getTime() - ninetyDays)).toBeLessThan(60_000);
    });

    it('should degrade to an EMPTY exclusion — never an error — when no vocabulary is declared', async () => {
      delete reader.terminalRawStatuses;
      repository.countForSourceSweep.mockResolvedValue(1);
      repository.findForSourceSweep.mockResolvedValue([candidate('r-1')]);
      reader.getReturn.mockResolvedValue(observation('r-1'));

      const result = await service.sync(connectionId, { limit: 10 });

      expect(lastFilter().terminalRawStatuses).toEqual([]);
      expect(result.terminalVocabularyDeclared).toBe(false);
      expect(result.scanned).toBe(1);
    });
  });

  describe('re-reads', () => {
    it('should re-read each candidate and persist the observation', async () => {
      repository.countForSourceSweep.mockResolvedValue(2);
      repository.findForSourceSweep.mockResolvedValue([candidate('r-1'), candidate('r-2')]);
      reader.getReturn.mockImplementation(({ externalReturnId }: { externalReturnId: string }) =>
        Promise.resolve(observation(externalReturnId))
      );

      const result = await service.sync(connectionId, { limit: 10 });

      expect(reader.getReturn).toHaveBeenCalledTimes(2);
      expect(returnsService.upsertFromObservation).toHaveBeenCalledTimes(2);
      expect(result).toMatchObject({ scanned: 2, updated: 2, attributed: 2, orphaned: 0 });
    });

    it('should split attributed and orphaned by what the WRITE reported', async () => {
      repository.countForSourceSweep.mockResolvedValue(2);
      repository.findForSourceSweep.mockResolvedValue([candidate('r-1'), candidate('r-2')]);
      reader.getReturn.mockImplementation(({ externalReturnId }: { externalReturnId: string }) =>
        Promise.resolve(observation(externalReturnId))
      );
      returnsService.upsertFromObservation
        .mockResolvedValueOnce({ record: { id: 'a' }, attributed: true })
        .mockResolvedValueOnce({ record: { id: 'b' }, attributed: false });

      const result = await service.sync(connectionId, { limit: 10 });

      expect(result).toMatchObject({ attributed: 1, orphaned: 1 });
    });

    it('should count a 404 and CONTINUE the page', async () => {
      repository.countForSourceSweep.mockResolvedValue(3);
      repository.findForSourceSweep.mockResolvedValue([
        candidate('r-1'),
        candidate('r-2'),
        candidate('r-3'),
      ]);
      reader.getReturn.mockImplementation(({ externalReturnId }: { externalReturnId: string }) => {
        if (externalReturnId === 'r-2') {
          return Promise.reject(Object.assign(new Error('Not Found'), { statusCode: 404 }));
        }
        return Promise.resolve(observation(externalReturnId));
      });

      const result = await service.sync(connectionId, { limit: 10 });

      expect(result).toMatchObject({ scanned: 3, updated: 2, notFound: 1, failed: 0 });
    });

    it('should count a non-404 failure separately and still continue', async () => {
      repository.countForSourceSweep.mockResolvedValue(2);
      repository.findForSourceSweep.mockResolvedValue([candidate('r-1'), candidate('r-2')]);
      reader.getReturn.mockImplementation(({ externalReturnId }: { externalReturnId: string }) => {
        if (externalReturnId === 'r-1') {
          return Promise.reject(Object.assign(new Error('Boom'), { statusCode: 500 }));
        }
        return Promise.resolve(observation(externalReturnId));
      });

      const result = await service.sync(connectionId, { limit: 10 });

      expect(result).toMatchObject({ scanned: 2, updated: 1, failed: 1, notFound: 0 });
    });

    it('should enqueue nothing — pass 2 re-reads inline', async () => {
      repository.countForSourceSweep.mockResolvedValue(1);
      repository.findForSourceSweep.mockResolvedValue([candidate('r-1')]);
      reader.getReturn.mockResolvedValue(observation('r-1'));

      const result = await service.sync(connectionId, { limit: 10 });

      // No queue is injected at all — the absence is the assertion. If a future
      // change fans this out, the constructor changes and this file breaks.
      expect(result.updated).toBe(1);
    });
  });

  describe('scan offset', () => {
    it('should advance by rows READ, not rows persisted', async () => {
      repository.countForSourceSweep.mockResolvedValue(10);
      repository.findForSourceSweep.mockResolvedValue([candidate('r-1'), candidate('r-2')]);
      reader.getReturn.mockRejectedValue(Object.assign(new Error('Boom'), { statusCode: 500 }));

      const result = await service.sync(connectionId, { limit: 2, offset: 4 });

      // Everything failed, yet the offset still moves: parking on a permanently
      // failing row would starve every other open return on the connection.
      expect(result).toMatchObject({ updated: 0, failed: 2, nextOffset: 6 });
    });

    it('should wrap to 0 at the end of the candidate set', async () => {
      repository.countForSourceSweep.mockResolvedValue(6);
      repository.findForSourceSweep.mockResolvedValue([candidate('r-5'), candidate('r-6')]);
      reader.getReturn.mockImplementation(({ externalReturnId }: { externalReturnId: string }) =>
        Promise.resolve(observation(externalReturnId))
      );

      const result = await service.sync(connectionId, { limit: 2, offset: 4 });

      expect(result.nextOffset).toBe(0);
    });

    it('should restart from 0 when the stored offset is past a shrunken total', async () => {
      repository.countForSourceSweep.mockResolvedValue(3);
      repository.findForSourceSweep.mockResolvedValue([candidate('r-1')]);
      reader.getReturn.mockResolvedValue(observation('r-1'));

      await service.sync(connectionId, { limit: 2, offset: 99 });

      expect(repository.findForSourceSweep).toHaveBeenCalledWith(expect.anything(), 2, 0);
    });

    it('should not read a page at all when nothing matches the filter', async () => {
      repository.countForSourceSweep.mockResolvedValue(0);

      const result = await service.sync(connectionId, { limit: 10, offset: 40 });

      expect(repository.findForSourceSweep).not.toHaveBeenCalled();
      expect(result).toMatchObject({ scanned: 0, total: 0, nextOffset: 0 });
    });
  });

  describe('degradation', () => {
    it('should return a zero result — never throw — when the adapter cannot read returns', async () => {
      integrations.getCapabilityAdapter.mockResolvedValue({ listOrderFeed: jest.fn() });

      const result = await service.sync(connectionId, { limit: 10 });

      expect(result).toMatchObject({ scanned: 0, total: 0, nextOffset: 0 });
      expect(repository.countForSourceSweep).not.toHaveBeenCalled();
    });

    it('should return a zero result when no OrderSource adapter resolves', async () => {
      integrations.getCapabilityAdapter.mockRejectedValue(new Error('disabled'));

      expect((await service.sync(connectionId, { limit: 10 })).scanned).toBe(0);
    });

    it('should resolve OrderSource — never the advertised-without-dispatch name', async () => {
      await service.sync(connectionId, { limit: 10 });

      expect(integrations.getCapabilityAdapter).toHaveBeenCalledWith(connectionId, 'OrderSource');
    });
  });
});
