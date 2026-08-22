/**
 * Inventory Sync Service Tests
 *
 * Unit tests for InventorySyncService. Focus on batch-vs-single behavior and partial failures.
 *
 * @module libs/core/src/inventory/application/services/__tests__
 */

import { InventorySyncService } from '../inventory-sync.service';
import type { OfferManagerPort, OfferQuantityBatchUpdater } from '@openlinker/core/listings';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { Connection, ConnectionConfig, ConnectionPort } from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';

describe('InventorySyncService', () => {
  let service: InventorySyncService;
  let integrationsService: jest.Mocked<IIntegrationsService>;
  let connectionPort: jest.Mocked<ConnectionPort>;
  let marketplace: jest.Mocked<OfferManagerPort & OfferQuantityBatchUpdater>;

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

    service = new InventorySyncService(integrationsService, connectionPort);
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
    // of (connectionId, offerId, quantity, observedAt) — same tuple → same key,
    // distinct tuple → distinct key (#2285).
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

  describe('observation-token idempotency key (#2285)', () => {
    const keyOf = (call: number): string | undefined =>
      marketplace.updateOfferQuantity.mock.calls[call][0].idempotencyKey;

    beforeEach(() => {
      marketplace.updateOfferQuantity.mockResolvedValue(undefined);
    });

    it('should derive different keys when the quantity is identical but the observation differs', async () => {
      await service.updateOfferQuantity(connectionId, {
        offerId: 'o1',
        quantity: 0,
        observedAt: '2026-08-01T00:00:00.000Z',
      });
      await service.updateOfferQuantity(connectionId, {
        offerId: 'o1',
        quantity: 0,
        observedAt: '2026-08-02T00:00:00.000Z',
      });

      expect(keyOf(0)).toMatch(/^inv:[a-f0-9]{16}$/);
      expect(keyOf(1)).toMatch(/^inv:[a-f0-9]{16}$/);
      expect(keyOf(1)).not.toBe(keyOf(0));
    });

    it('should derive the same key when the observation is the same', async () => {
      const observedAt = '2026-08-01T00:00:00.000Z';
      await service.updateOfferQuantity(connectionId, { offerId: 'o1', quantity: 3, observedAt });
      await service.updateOfferQuantity(connectionId, { offerId: 'o1', quantity: 3, observedAt });

      expect(keyOf(1)).toBe(keyOf(0));
    });

    it('should keep an explicit idempotency key ahead of the derived one', async () => {
      await service.updateOfferQuantity(connectionId, {
        offerId: 'o1',
        quantity: 3,
        idempotencyKey: 'caller-key',
        observedAt: '2026-08-01T00:00:00.000Z',
      });

      expect(keyOf(0)).toBe('caller-key');
    });

    it('should fall back to an unversioned key and warn when no observation is supplied', async () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      await service.updateOfferQuantity(connectionId, { offerId: 'o1', quantity: 3 });

      expect(keyOf(0)).toMatch(/^inv:[a-f0-9]{16}$/);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('inventory_quantity_key_unversioned')
      );
      warnSpy.mockRestore();
    });

    it('should mint three distinct keys for a restock-to-the-same-quantity sequence', async () => {
      // qty 5 @ t0 -> qty 0 @ t1 -> qty 5 @ t2. Pre-#2285 the third write reused the
      // first write's key and was swallowed by the destination's command-id dedup,
      // leaving the offer selling at a quantity it no longer had.
      await service.updateOfferQuantity(connectionId, {
        offerId: 'o1',
        quantity: 5,
        observedAt: '2026-08-01T00:00:00.000Z',
      });
      await service.updateOfferQuantity(connectionId, {
        offerId: 'o1',
        quantity: 0,
        observedAt: '2026-08-02T00:00:00.000Z',
      });
      await service.updateOfferQuantity(connectionId, {
        offerId: 'o1',
        quantity: 5,
        observedAt: '2026-08-03T00:00:00.000Z',
      });

      expect(marketplace.updateOfferQuantity).toHaveBeenCalledTimes(3);
      expect(new Set([keyOf(0), keyOf(1), keyOf(2)]).size).toBe(3);
    });

    it('should never derive the key from wall-clock time', async () => {
      const input = {
        offerId: 'o1',
        quantity: 5,
        observedAt: '2026-08-01T00:00:00.000Z',
      };

      jest.useFakeTimers().setSystemTime(new Date('2026-08-10T00:00:00.000Z'));
      await service.updateOfferQuantity(connectionId, input);
      jest.setSystemTime(new Date('2027-01-01T00:00:00.000Z'));
      await service.updateOfferQuantity(connectionId, input);
      jest.useRealTimers();

      expect(keyOf(1)).toBe(keyOf(0));
    });
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

      // Scoped to the buffer warn: an item with no observation token separately warns
      // about its unversioned idempotency key (#2285).
      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('present but invalid'));
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
});
