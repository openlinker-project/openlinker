/**
 * Subiekt Inventory Master Adapter — unit tests
 *
 * Mocks `SubiektInventoryBridgeClient` and `IdentifierMappingPort` — never a
 * real bridge (no live Windows bridge is reachable from this worktree; see
 * the adapter's own header for why the wire contract is unreconciled).
 *
 * @module libs/integrations/subiekt/src/infrastructure/adapters/__tests__
 */
import type { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { MasterProductNotFoundError } from '@openlinker/core/products';
import type { LoggerPort } from '@openlinker/shared/logging';
import { SubiektInventoryMasterAdapter } from '../subiekt-inventory-master.adapter';
import type { SubiektInventoryBridgeClient } from '../../http/subiekt-inventory-bridge.client';
import { SubiektRejectedError } from '../../../bridge/subiekt-bridge.errors';
import { SubiektConfigException } from '../../../domain/exceptions/subiekt-config.exception';
import { SubiektNotSupportedException } from '../../../domain/exceptions/subiekt-not-supported.exception';

const CONNECTION_ID = 'conn-1';
const PRODUCT_ID = 'ol_product_abc';
const TOWAR_SYMBOL = 'TW-001';

describe('SubiektInventoryMasterAdapter', () => {
  let bridge: jest.Mocked<Pick<SubiektInventoryBridgeClient, 'getStock' | 'adjust'>>;
  let identifierMapping: jest.Mocked<IdentifierMappingPort>;
  let logger: jest.Mocked<LoggerPort>;
  let adapter: SubiektInventoryMasterAdapter;

  beforeEach(() => {
    bridge = {
      getStock: jest.fn(),
      adjust: jest.fn(),
    };
    identifierMapping = {
      getOrCreateInternalId: jest.fn(),
      getInternalId: jest.fn(),
      getExternalIds: jest.fn(),
      createMapping: jest.fn(),
      batchGetOrCreateInternalIds: jest.fn(),
    } as unknown as jest.Mocked<IdentifierMappingPort>;
    logger = { log: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };

    identifierMapping.getExternalIds.mockResolvedValue([
      { externalId: TOWAR_SYMBOL, platformType: 'subiekt-gt', connectionId: CONNECTION_ID, entityType: 'Product' },
    ]);

    adapter = new SubiektInventoryMasterAdapter(
      bridge as unknown as SubiektInventoryBridgeClient,
      identifierMapping,
      CONNECTION_ID,
      logger,
    );
  });

  describe('getInventory', () => {
    it('should fall back to summing every magazyn when the bridge reports no release warehouse (pre-field bridge)', async () => {
      // A bridge predating `domyslnyMagazynId`. Summing is an over-count on a
      // multi-warehouse install, but picking a warehouse on no information at
      // all would be worse — so the pre-fix behaviour is preserved verbatim.
      bridge.getStock.mockResolvedValue({
        towarSymbol: TOWAR_SYMBOL,
        positions: [
          { magazynId: 1, magazynSymbol: 'GŁ', stan: 10, stanRez: 2 },
          { magazynId: 2, magazynSymbol: 'FIL', stan: 5, stanRez: 0 },
        ],
      });

      const inventory = await adapter.getInventory(PRODUCT_ID);

      expect(inventory.quantity).toBe(15);
      expect(inventory.reserved).toBe(2);
      expect(inventory.available).toBe(13);
      expect(inventory.productId).toBe(PRODUCT_ID);
      expect(inventory.locationId).toBeUndefined();
    });

    it('should publish ONLY the release magazyn the bridge names, not the sum', async () => {
      bridge.getStock.mockResolvedValue({
        towarSymbol: TOWAR_SYMBOL,
        positions: [
          { magazynId: 1, magazynSymbol: 'MAG', stan: 506, stanRez: 0 },
          { magazynId: 2, magazynSymbol: 'MAP', stan: 2, stanRez: 0 },
        ],
        domyslnyMagazynId: 1,
      });

      const inventory = await adapter.getInventory(PRODUCT_ID);

      // 508 was the oversell: the 2 units in MAP can never ship.
      expect(inventory.quantity).toBe(506);
      expect(inventory.available).toBe(506);
    });

    it('should warn when a towar is stocked in several magazyny and the connection names none', async () => {
      bridge.getStock.mockResolvedValue({
        towarSymbol: TOWAR_SYMBOL,
        positions: [
          { magazynId: 1, magazynSymbol: 'MAG', stan: 506, stanRez: 0 },
          { magazynId: 2, magazynSymbol: 'MAP', stan: 2, stanRez: 0 },
        ],
        domyslnyMagazynId: 1,
      });

      await adapter.getInventory(PRODUCT_ID);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('subiekt_inventory_multi_magazyn_default'),
        expect.objectContaining({ usingMagazynId: 1, magazynIds: [1, 2] }),
      );
    });

    it('should NOT warn when the towar sits in a single magazyn', async () => {
      bridge.getStock.mockResolvedValue({
        towarSymbol: TOWAR_SYMBOL,
        positions: [{ magazynId: 1, magazynSymbol: 'MAG', stan: 28, stanRez: 0 }],
        domyslnyMagazynId: 1,
      });

      await adapter.getInventory(PRODUCT_ID);

      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('should prefer the operator-configured magazyn over the bridge default', async () => {
      const configured = new SubiektInventoryMasterAdapter(
        bridge as unknown as SubiektInventoryBridgeClient,
        identifierMapping,
        CONNECTION_ID,
        logger,
        2,
      );
      bridge.getStock.mockResolvedValue({
        towarSymbol: TOWAR_SYMBOL,
        positions: [
          { magazynId: 1, magazynSymbol: 'MAG', stan: 506, stanRez: 0 },
          { magazynId: 2, magazynSymbol: 'MAP', stan: 2, stanRez: 0 },
        ],
        domyslnyMagazynId: 1,
      });

      const inventory = await configured.getInventory(PRODUCT_ID);

      expect(inventory.quantity).toBe(2);
      // An explicit operator choice is a fact, not a guess — nothing to warn about.
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('should let an explicit caller locationId win over both', async () => {
      const configured = new SubiektInventoryMasterAdapter(
        bridge as unknown as SubiektInventoryBridgeClient,
        identifierMapping,
        CONNECTION_ID,
        logger,
        1,
      );
      bridge.getStock.mockResolvedValue({
        towarSymbol: TOWAR_SYMBOL,
        positions: [
          { magazynId: 1, magazynSymbol: 'MAG', stan: 506, stanRez: 0 },
          { magazynId: 2, magazynSymbol: 'MAP', stan: 2, stanRez: 0 },
        ],
        domyslnyMagazynId: 1,
      });

      const inventory = await configured.getInventory(PRODUCT_ID, '2');

      expect(inventory.quantity).toBe(2);
    });

    it('should filter to one magazyn when locationId is given', async () => {
      bridge.getStock.mockResolvedValue({
        towarSymbol: TOWAR_SYMBOL,
        positions: [
          { magazynId: 1, magazynSymbol: 'GŁ', stan: 10, stanRez: 2 },
          { magazynId: 2, magazynSymbol: 'FIL', stan: 5, stanRez: 0 },
        ],
      });

      const inventory = await adapter.getInventory(PRODUCT_ID, '2');

      expect(inventory.quantity).toBe(5);
      expect(inventory.available).toBe(5);
    });

    it('should throw SubiektConfigException when there is no external id mapping for this connection', async () => {
      identifierMapping.getExternalIds.mockResolvedValue([]);

      await expect(adapter.getInventory(PRODUCT_ID)).rejects.toBeInstanceOf(SubiektConfigException);
    });

    it('should translate a bridge not-found rejection into MasterProductNotFoundError', async () => {
      bridge.getStock.mockRejectedValue(new SubiektRejectedError('Towar nie znaleziono'));

      await expect(adapter.getInventory(PRODUCT_ID)).rejects.toBeInstanceOf(
        MasterProductNotFoundError,
      );
    });
  });

  describe('listInventory', () => {
    it('should return exactly one product-level entry (no per-variant combinations)', async () => {
      bridge.getStock.mockResolvedValue({
        towarSymbol: TOWAR_SYMBOL,
        positions: [{ magazynId: 1, magazynSymbol: 'GŁ', stan: 7, stanRez: 0 }],
      });

      const result = await adapter.listInventory(PRODUCT_ID);

      expect(result).toHaveLength(1);
      expect(result[0]?.quantity).toBe(7);
    });
  });

  describe('getAvailableQuantity', () => {
    it('should sum (stan - stanRez) across positions', async () => {
      bridge.getStock.mockResolvedValue({
        towarSymbol: TOWAR_SYMBOL,
        positions: [
          { magazynId: 1, magazynSymbol: 'GŁ', stan: 10, stanRez: 3 },
          { magazynId: 2, magazynSymbol: 'FIL', stan: 4, stanRez: 1 },
        ],
      });

      await expect(adapter.getAvailableQuantity(PRODUCT_ID)).resolves.toBe(10);
    });

    it('should return ONLY the release warehouse (stan - stanRez), not the sum across magazyny', async () => {
      // Same oversell the `getInventory` fix closes, one level down: a sale
      // releases from ONE warehouse, so `getAvailableQuantity` must resolve
      // the release magazyn exactly as `getInventory` does rather than
      // re-summing every position it happens to read.
      bridge.getStock.mockResolvedValue({
        towarSymbol: TOWAR_SYMBOL,
        positions: [
          { magazynId: 1, magazynSymbol: 'MAG', stan: 506, stanRez: 6 },
          { magazynId: 2, magazynSymbol: 'MAP', stan: 2, stanRez: 0 },
        ],
        domyslnyMagazynId: 1,
      });

      // 508 - 6 = 502 would be the oversell; only magazyn 1's own figure may
      // be published.
      await expect(adapter.getAvailableQuantity(PRODUCT_ID)).resolves.toBe(500);
    });

    it('should honour an explicit stockMagazynId over the bridge default', async () => {
      const configured = new SubiektInventoryMasterAdapter(
        bridge as unknown as SubiektInventoryBridgeClient,
        identifierMapping,
        CONNECTION_ID,
        logger,
        2,
      );
      bridge.getStock.mockResolvedValue({
        towarSymbol: TOWAR_SYMBOL,
        positions: [
          { magazynId: 1, magazynSymbol: 'MAG', stan: 506, stanRez: 0 },
          { magazynId: 2, magazynSymbol: 'MAP', stan: 2, stanRez: 1 },
        ],
        domyslnyMagazynId: 1,
      });

      await expect(configured.getAvailableQuantity(PRODUCT_ID)).resolves.toBe(1);
    });

    it('should throw SubiektConfigException when the configured stockMagazynId names no position this towar is stocked in', async () => {
      const configured = new SubiektInventoryMasterAdapter(
        bridge as unknown as SubiektInventoryBridgeClient,
        identifierMapping,
        CONNECTION_ID,
        logger,
        99,
      );
      bridge.getStock.mockResolvedValue({
        towarSymbol: TOWAR_SYMBOL,
        positions: [{ magazynId: 1, magazynSymbol: 'MAG', stan: 506, stanRez: 0 }],
        domyslnyMagazynId: 1,
      });

      await expect(configured.getAvailableQuantity(PRODUCT_ID)).rejects.toBeInstanceOf(
        SubiektConfigException,
      );
    });
  });

  describe('adjustInventory', () => {
    it('should report disposition applied + idempotency not_requested when no key is supplied', async () => {
      bridge.adjust.mockResolvedValue({
        deduplicated: false,
        documentId: 42,
        documentNumber: 'PW 1/2026',
        stanAfter: 20,
      });
      bridge.getStock.mockResolvedValue({
        towarSymbol: TOWAR_SYMBOL,
        positions: [{ magazynId: 1, magazynSymbol: 'GŁ', stan: 20, stanRez: 0 }],
      });

      const result = await adapter.adjustInventory({ productId: PRODUCT_ID, quantity: 10 });

      expect(bridge.adjust).toHaveBeenCalledWith(
        expect.objectContaining({ towarSymbol: TOWAR_SYMBOL, delta: 10 }),
      );
      expect(result.quantity).toBe(20);
      expect(result.adjustmentOutcome).toEqual({
        disposition: 'applied',
        idempotency: 'not_requested',
        appliedAt: null,
      });
    });

    it('should report disposition deduplicated + idempotency honoured on a repeat key', async () => {
      bridge.adjust.mockResolvedValue({
        deduplicated: true,
        documentId: 42,
        documentNumber: 'PW 1/2026',
        stanAfter: 20,
      });
      bridge.getStock.mockResolvedValue({
        towarSymbol: TOWAR_SYMBOL,
        positions: [{ magazynId: 1, magazynSymbol: 'GŁ', stan: 20, stanRez: 0 }],
      });

      const result = await adapter.adjustInventory({
        productId: PRODUCT_ID,
        quantity: 10,
        idempotencyKey: 'return:ol_return_1:line1:1',
      });

      expect(result.adjustmentOutcome?.disposition).toBe('deduplicated');
      expect(result.adjustmentOutcome?.idempotency).toBe('honoured');
    });

    it('should pass a negative delta through unchanged (RW on the bridge side)', async () => {
      bridge.adjust.mockResolvedValue({
        deduplicated: false,
        documentId: 43,
        documentNumber: 'RW 1/2026',
        stanAfter: 5,
      });
      bridge.getStock.mockResolvedValue({
        towarSymbol: TOWAR_SYMBOL,
        positions: [{ magazynId: 1, magazynSymbol: 'GŁ', stan: 5, stanRez: 0 }],
      });

      await adapter.adjustInventory({ productId: PRODUCT_ID, quantity: -5, reason: 'manual_correction' });

      expect(bridge.adjust).toHaveBeenCalledWith(
        expect.objectContaining({ delta: -5, uwagi: 'manual_correction' }),
      );
    });
  });

  describe('reserveInventory / releaseInventory', () => {
    it('should reject with SubiektNotSupportedException (ADR-061 — deprecated in place)', async () => {
      await expect(adapter.reserveInventory(PRODUCT_ID, 1, 'ol_order_1')).rejects.toBeInstanceOf(
        SubiektNotSupportedException,
      );
      await expect(adapter.releaseInventory(PRODUCT_ID, 1, 'ol_order_1')).rejects.toBeInstanceOf(
        SubiektNotSupportedException,
      );
    });
  });
});
