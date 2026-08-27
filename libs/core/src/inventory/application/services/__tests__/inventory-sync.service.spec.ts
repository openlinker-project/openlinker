/**
 * Inventory Sync Service Tests
 *
 * Unit tests for InventorySyncService. Focus on batch-vs-single behavior and partial failures.
 *
 * @module libs/core/src/inventory/application/services/__tests__
 */

import { InventorySyncService } from '../inventory-sync.service';
import type {
  OfferManagerPort,
  OfferQuantityBatchUpdater,
  UpdateOfferQuantitiesBatchResult,
} from '@openlinker/core/listings';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { Connection, ConnectionConfig, ConnectionPort } from '@openlinker/core/identifier-mapping';
import type { ISyncCursorsService, SyncLockPort } from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';

describe('InventorySyncService', () => {
  let service: InventorySyncService;
  let integrationsService: jest.Mocked<IIntegrationsService>;
  let connectionPort: jest.Mocked<ConnectionPort>;
  let marketplace: jest.Mocked<OfferManagerPort & OfferQuantityBatchUpdater>;
  let syncLock: jest.Mocked<SyncLockPort>;
  let syncCursors: jest.Mocked<ISyncCursorsService>;
  /** In-memory stand-in for the durable per-offer observation mark. */
  let marks: Map<string, string>;

  const connectionId = 'connection-123';

  const connectionWithConfig = (config: ConnectionConfig): Connection =>
    ({ id: connectionId, config } as unknown as Connection);

  beforeEach(() => {
    marketplace = {
      listOrderFeed: jest.fn(),
      getOrder: jest.fn(),
      updateOfferQuantity: jest.fn(),
      updateOfferQuantitiesBatch: jest.fn(),
    } as unknown as jest.Mocked<OfferManagerPort & OfferQuantityBatchUpdater>;

    integrationsService = {
      getCapabilityAdapter: jest.fn().mockResolvedValue(marketplace),
      getAdapter: jest.fn(),
      listCapabilityAdapters: jest.fn(),
    } as unknown as jest.Mocked<IIntegrationsService>;

    connectionPort = {
      get: jest.fn().mockResolvedValue(connectionWithConfig({})),
      list: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      disable: jest.fn(),
    } as unknown as jest.Mocked<ConnectionPort>;

    marks = new Map<string, string>();
    syncCursors = {
      getCursor: jest.fn((cid: string, key: string) =>
        Promise.resolve(marks.get(`${cid}|${key}`) ?? null)
      ),
      advanceCursor: jest.fn((cid: string, key: string, value: string) => {
        marks.set(`${cid}|${key}`, value);
        return Promise.resolve();
      }),
    } as unknown as jest.Mocked<ISyncCursorsService>;

    const heldLocks = new Set<string>();
    syncLock = {
      acquire: jest.fn((key: string) => {
        if (heldLocks.has(key)) return Promise.resolve(null);
        heldLocks.add(key);
        return Promise.resolve(`token:${key}`);
      }),
      release: jest.fn((key: string) => Promise.resolve(heldLocks.delete(key))),
      extend: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<SyncLockPort>;

    service = new InventorySyncService(
      integrationsService,
      connectionPort,
      syncLock,
      syncCursors
    );
  });

  it('uses batch API when available and multiple items provided', async () => {
    (marketplace.updateOfferQuantitiesBatch as unknown as jest.Mock).mockResolvedValueOnce({
      succeeded: ['o1', 'o2'],
      failed: [],
    });

    const result = await service.updateOfferQuantities(connectionId, {
      items: [
        { offerId: 'o1', quantity: 1, idempotencyKey: 'k1' },
        { offerId: 'o2', quantity: 2, idempotencyKey: 'k2' },
      ],
    });

    expect(marketplace.updateOfferQuantitiesBatch).toHaveBeenCalledTimes(1);
    expect(marketplace.updateOfferQuantity).not.toHaveBeenCalled();
    expect(result).toEqual({ succeeded: ['o1', 'o2'], failed: [] });
  });

  it('falls back to per-item updates and reports partial failures', async () => {
    // Make batch fail so service falls back to per-item
    (marketplace.updateOfferQuantitiesBatch as unknown as jest.Mock).mockRejectedValueOnce(
      new Error('batch failed')
    );
    marketplace.updateOfferQuantity
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('boom'));

    const result = await service.updateOfferQuantities(connectionId, {
      items: [
        { offerId: 'o1', quantity: 1, idempotencyKey: 'k1' },
        { offerId: 'o2', quantity: 2, idempotencyKey: 'k2' },
      ],
    });

    expect(marketplace.updateOfferQuantity).toHaveBeenCalledTimes(2);
    expect(result.succeeded).toEqual(['o1']);
    expect(result.failed).toEqual([{ offerId: 'o2', errorCode: 'unknown', message: 'boom' }]);
  });

  it('should short-circuit with an empty result when items is empty (no adapter resolution)', async () => {
    const result = await service.updateOfferQuantities(connectionId, { items: [] });

    expect(result).toEqual({ succeeded: [], failed: [] });
    expect(integrationsService.getCapabilityAdapter).not.toHaveBeenCalled();
    expect(marketplace.updateOfferQuantitiesBatch).not.toHaveBeenCalled();
    expect(marketplace.updateOfferQuantity).not.toHaveBeenCalled();
  });

  it('should delegate updateOfferQuantity to updateOfferQuantities for the single-item path', async () => {
    // Single item path: never batched (batch is gated to length > 1), goes through per-item loop.
    marketplace.updateOfferQuantity.mockResolvedValueOnce(undefined);

    const result = await service.updateOfferQuantity(connectionId, {
      offerId: 'o1',
      quantity: 7,
      idempotencyKey: 'k1',
    });

    expect(marketplace.updateOfferQuantitiesBatch).not.toHaveBeenCalled();
    expect(marketplace.updateOfferQuantity).toHaveBeenCalledTimes(1);
    expect(marketplace.updateOfferQuantity).toHaveBeenCalledWith({
      offerId: 'o1',
      quantity: 7,
      idempotencyKey: 'k1',
    });
    expect(result).toEqual({ succeeded: ['o1'], failed: [] });
  });

  it('should force per-item updates when the adapter does not implement OfferQuantityBatchUpdater', async () => {
    // Construct a marketplace adapter that lacks updateOfferQuantitiesBatch entirely —
    // isOfferQuantityBatchUpdater() checks `typeof obj.updateOfferQuantitiesBatch === 'function'`,
    // so omitting the key makes the guard return false and forces the per-item path.
    const minimalMarketplace = {
      updateOfferQuantity: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<OfferManagerPort>;
    integrationsService.getCapabilityAdapter.mockResolvedValueOnce(minimalMarketplace);

    const result = await service.updateOfferQuantities(connectionId, {
      items: [
        { offerId: 'o1', quantity: 1, idempotencyKey: 'k1' },
        { offerId: 'o2', quantity: 2, idempotencyKey: 'k2' },
      ],
    });

    expect(minimalMarketplace.updateOfferQuantity).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ succeeded: ['o1', 'o2'], failed: [] });
  });

  it('should auto-generate a deterministic idempotency key when an item omits one', async () => {
    // Single-item path (length === 1) forces per-item loop, which lets us inspect the
    // normalized item passed to updateOfferQuantity. The key is a SHA-256 truncation
    // of (connectionId, offerId, quantity) — same tuple → same key, distinct tuple → distinct key.
    marketplace.updateOfferQuantity.mockResolvedValue(undefined);

    await service.updateOfferQuantities(connectionId, {
      items: [{ offerId: 'o1', quantity: 7 }],
    });
    await service.updateOfferQuantities(connectionId, {
      items: [{ offerId: 'o1', quantity: 7 }],
    });

    expect(marketplace.updateOfferQuantity).toHaveBeenCalledTimes(2);
    const firstCallArg = marketplace.updateOfferQuantity.mock.calls[0][0];
    const secondCallArg = marketplace.updateOfferQuantity.mock.calls[1][0];

    expect(firstCallArg.idempotencyKey).toMatch(/^inv:[a-f0-9]{16}$/);
    // Same (connectionId, offerId, quantity) tuple → same key. Deterministic SHA-256 truncation.
    expect(secondCallArg.idempotencyKey).toBe(firstCallArg.idempotencyKey);

    // Distinct quantity → distinct key.
    await service.updateOfferQuantities(connectionId, {
      items: [{ offerId: 'o1', quantity: 8 }],
    });
    const thirdCallArg = marketplace.updateOfferQuantity.mock.calls[2][0];
    expect(thirdCallArg.idempotencyKey).toMatch(/^inv:[a-f0-9]{16}$/);
    expect(thirdCallArg.idempotencyKey).not.toBe(firstCallArg.idempotencyKey);
  });

  describe('stock safety buffer (#1844)', () => {
    it('should pass master quantity through unchanged when the connection has no buffer (default 0)', async () => {
      connectionPort.get.mockResolvedValue(connectionWithConfig({}));
      marketplace.updateOfferQuantity.mockResolvedValue(undefined);

      await service.updateOfferQuantity(connectionId, { offerId: 'o1', quantity: 10 });

      expect(marketplace.updateOfferQuantity).toHaveBeenCalledWith(
        expect.objectContaining({ offerId: 'o1', quantity: 10 })
      );
    });

    it('should subtract the per-connection reserve from the written-back quantity', async () => {
      connectionPort.get.mockResolvedValue(connectionWithConfig({ stockSafetyBuffer: 3 }));
      marketplace.updateOfferQuantity.mockResolvedValue(undefined);

      await service.updateOfferQuantity(connectionId, { offerId: 'o1', quantity: 10 });

      expect(marketplace.updateOfferQuantity).toHaveBeenCalledWith(
        expect.objectContaining({ offerId: 'o1', quantity: 7 })
      );
    });

    it('should floor the written-back quantity at 0 when the reserve exceeds master stock', async () => {
      connectionPort.get.mockResolvedValue(connectionWithConfig({ stockSafetyBuffer: 5 }));
      marketplace.updateOfferQuantity.mockResolvedValue(undefined);

      await service.updateOfferQuantity(connectionId, { offerId: 'o1', quantity: 2 });

      expect(marketplace.updateOfferQuantity).toHaveBeenCalledWith(
        expect.objectContaining({ offerId: 'o1', quantity: 0 })
      );
    });

    it('should warn (but still pass through) when the buffer is present but invalid', async () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      connectionPort.get.mockResolvedValue(
        connectionWithConfig({ stockSafetyBuffer: -3 as unknown as number })
      );
      marketplace.updateOfferQuantity.mockResolvedValue(undefined);

      await service.updateOfferQuantity(connectionId, { offerId: 'o1', quantity: 10 });

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('present but invalid'));
      // Coerces to 0 reserve => quantity passes through unchanged.
      expect(marketplace.updateOfferQuantity).toHaveBeenCalledWith(
        expect.objectContaining({ offerId: 'o1', quantity: 10 })
      );
      warnSpy.mockRestore();
    });

    it('should not warn when the buffer is absent (default 0)', async () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      connectionPort.get.mockResolvedValue(connectionWithConfig({}));
      marketplace.updateOfferQuantity.mockResolvedValue(undefined);

      await service.updateOfferQuantity(connectionId, { offerId: 'o1', quantity: 10 });

      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('should apply the reserve to every item in a batch update', async () => {
      connectionPort.get.mockResolvedValue(connectionWithConfig({ stockSafetyBuffer: 2 }));
      (marketplace.updateOfferQuantitiesBatch as unknown as jest.Mock).mockResolvedValueOnce({
        succeeded: ['o1', 'o2'],
        failed: [],
      });

      await service.updateOfferQuantities(connectionId, {
        items: [
          { offerId: 'o1', quantity: 10, idempotencyKey: 'k1' },
          { offerId: 'o2', quantity: 1, idempotencyKey: 'k2' },
        ],
      });

      expect(marketplace.updateOfferQuantitiesBatch).toHaveBeenCalledWith(
        expect.objectContaining({
          items: [
            expect.objectContaining({ offerId: 'o1', quantity: 8 }),
            expect.objectContaining({ offerId: 'o2', quantity: 0 }),
          ],
        })
      );
    });
  });

  describe('write-order guard (#2617)', () => {
    const older = '2026-08-27T10:00:00.000Z';
    const newer = '2026-08-27T10:00:05.000Z';

    const write = (
      quantity: number,
      observedAt: string
    ): Promise<UpdateOfferQuantitiesBatchResult> =>
      service.updateOfferQuantity(connectionId, { offerId: 'o1', quantity, observedAt });

    it('should resolve to the newer quantity when the newer write arrives first', async () => {
      await write(2, newer);
      await write(9, older);

      expect(marketplace.updateOfferQuantity).toHaveBeenCalledTimes(1);
      expect(marketplace.updateOfferQuantity).toHaveBeenCalledWith(
        expect.objectContaining({ quantity: 2 })
      );
    });

    it('should resolve to the newer quantity when the newer write arrives second', async () => {
      await write(9, older);
      await write(2, newer);

      const calls = (marketplace.updateOfferQuantity as unknown as jest.Mock).mock
        .calls as ReadonlyArray<readonly [{ quantity: number }]>;
      const written = calls.map((call) => call[0].quantity);
      expect(written).toEqual([9, 2]);
    });

    it('should report a superseded write as done, so the job does not retry forever', async () => {
      await write(2, newer);
      const result = await write(9, older);

      expect(result).toEqual({ succeeded: ['o1'], failed: [] });
    });

    it('should not lock out an older write when the newer write failed', async () => {
      (marketplace.updateOfferQuantity as unknown as jest.Mock).mockRejectedValueOnce(
        new Error('marketplace unavailable')
      );

      const failed = await write(2, newer);
      expect(failed.failed).toHaveLength(1);

      // The mark advances only after a successful write, so the channel is not
      // left stale by a refusal that followed a failure.
      const recovered = await write(9, older);
      expect(recovered).toEqual({ succeeded: ['o1'], failed: [] });
      expect(marketplace.updateOfferQuantity).toHaveBeenLastCalledWith(
        expect.objectContaining({ quantity: 9 })
      );
    });

    it('should allow a retry of the same observation', async () => {
      await write(2, newer);
      await write(2, newer);

      expect(marketplace.updateOfferQuantity).toHaveBeenCalledTimes(2);
    });

    it('should release the per-offer lock after every write', async () => {
      await write(2, newer);

      expect(syncLock.release).toHaveBeenCalledTimes(1);
    });

    it('should report contention as a retryable failure rather than dropping the write', async () => {
      (syncLock.acquire as unknown as jest.Mock).mockResolvedValueOnce(null);

      const result = await write(2, newer);

      expect(result.failed).toEqual([
        expect.objectContaining({ offerId: 'o1', errorCode: 'write_contended' }),
      ]);
      expect(marketplace.updateOfferQuantity).not.toHaveBeenCalled();
    });

    it('should write unguarded when the caller quotes no observation', async () => {
      await service.updateOfferQuantity(connectionId, { offerId: 'o1', quantity: 0 });

      expect(syncLock.acquire).not.toHaveBeenCalled();
      expect(marketplace.updateOfferQuantity).toHaveBeenCalledWith(
        expect.objectContaining({ quantity: 0 })
      );
    });

    // #2617 review: guarding an observed batch must not cost N-1 extra
    // marketplace calls. Each item is locked and compared first, then the
    // survivors go out in ONE batch call.
    it('should keep the single batch call for an observed batch', async () => {
      (marketplace.updateOfferQuantitiesBatch as unknown as jest.Mock).mockResolvedValueOnce({
        succeeded: ['o1', 'o2'],
        failed: [],
      });

      await service.updateOfferQuantities(connectionId, {
        items: [
          { offerId: 'o1', quantity: 1, observedAt: newer },
          { offerId: 'o2', quantity: 2, observedAt: newer },
        ],
      });

      expect(marketplace.updateOfferQuantitiesBatch).toHaveBeenCalledTimes(1);
      expect(marketplace.updateOfferQuantity).not.toHaveBeenCalled();
      expect(syncCursors.advanceCursor).toHaveBeenCalledTimes(2);
      expect(syncLock.release).toHaveBeenCalledTimes(2);
    });

    it('should drop a superseded item from the batch and keep the rest', async () => {
      (syncCursors.getCursor as unknown as jest.Mock).mockImplementation(
        (_conn: string, key: string) => Promise.resolve(key.includes('o1') ? newer : null)
      );
      (marketplace.updateOfferQuantitiesBatch as unknown as jest.Mock).mockResolvedValueOnce({
        succeeded: ['o2'],
        failed: [],
      });

      const result = await service.updateOfferQuantities(connectionId, {
        items: [
          { offerId: 'o1', quantity: 1, observedAt: older },
          { offerId: 'o2', quantity: 2, observedAt: newer },
        ],
      });

      expect(marketplace.updateOfferQuantitiesBatch).toHaveBeenCalledWith(
        expect.objectContaining({ items: [expect.objectContaining({ offerId: 'o2' })] })
      );
      expect(result.succeeded).toEqual(expect.arrayContaining(['o1', 'o2']));
      // Only the item the adapter actually wrote may claim the channel.
      expect(syncCursors.advanceCursor).toHaveBeenCalledTimes(1);
    });

    it('should not advance the mark for an item the batch reported as failed', async () => {
      (marketplace.updateOfferQuantitiesBatch as unknown as jest.Mock).mockResolvedValueOnce({
        succeeded: ['o1'],
        failed: [{ offerId: 'o2', errorCode: 'unknown', message: 'rejected' }],
      });

      await service.updateOfferQuantities(connectionId, {
        items: [
          { offerId: 'o1', quantity: 1, observedAt: newer },
          { offerId: 'o2', quantity: 2, observedAt: newer },
        ],
      });

      expect(syncCursors.advanceCursor).toHaveBeenCalledTimes(1);
    });
  });
});
