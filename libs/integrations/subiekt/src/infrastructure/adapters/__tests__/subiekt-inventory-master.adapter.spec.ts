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

  describe('a model-keyed product (several towary, one product)', () => {
    const MODEL_PRODUCT_ID = 'ol_product_model';
    let modelAdapter: SubiektInventoryMasterAdapter;

    beforeEach(() => {
      identifierMapping.getExternalIds.mockImplementation((entityType: string, internalId: string) => {
        if (entityType === 'Product' && internalId === MODEL_PRODUCT_ID) {
          return Promise.resolve([
            { externalId: 'model:1', platformType: 'subiekt-gt', connectionId: CONNECTION_ID, entityType: 'Product' },
          ]);
        }
        if (entityType === 'ProductVariant' && internalId === 'ol_variant_50') {
          return Promise.resolve([
            { externalId: 'WOBLACK50', platformType: 'subiekt-gt', connectionId: CONNECTION_ID, entityType: 'ProductVariant' },
          ]);
        }
        return Promise.resolve([]);
      });
      identifierMapping.getOrCreateInternalId.mockImplementation((_t: string, externalId: string) =>
        Promise.resolve(`ol_variant_${externalId}`),
      );
      bridge.getStock.mockImplementation((symbol: string) =>
        Promise.resolve({
          towarSymbol: symbol,
          positions: [{ magazynId: 1, magazynSymbol: 'GŁ', stan: symbol === 'WOBLACK100' ? 517 : 516, stanRez: 0 }],
          domyslnyMagazynId: 1,
        }),
      );

      modelAdapter = new SubiektInventoryMasterAdapter(
        bridge as unknown as SubiektInventoryBridgeClient,
        identifierMapping,
        CONNECTION_ID,
        logger,
        undefined,
        () => Promise.resolve(['WOBLACK100', 'WOBLACK50']),
      );
    });

    it('listInventory emits one row PER VARIANT, each stamped with its variantId', async () => {
      // The whole point. MasterInventorySyncService keys a row to
      // `Inventory.variantId`, falling back to "the product's lone variant"
      // only when there IS one. A model-keyed product has several, so without
      // the stamp every variant would miss its stock silently.
      const rows = await modelAdapter.listInventory(MODEL_PRODUCT_ID);

      expect(rows).toHaveLength(2);
      // The CANONICAL key, which is what `SubiektProductMasterAdapter` writes
      // the variant row under. This expectation used to pin the bare symbol,
      // and that is exactly why the two writers were able to disagree about
      // identity while agreeing about quantity: the mock derives the id from
      // whatever external id it is handed, so it passed under either.
      expect(rows.map((r) => r.variantId)).toEqual([
        'ol_variant_WOBLACK100::variant',
        'ol_variant_WOBLACK50::variant',
      ]);
      expect(rows.map((r) => r.quantity)).toEqual([517, 516]);
      expect(rows.every((r) => r.productId === MODEL_PRODUCT_ID)).toBe(true);
    });

    // An install already carrying the bare mapping keeps it. Re-keying those
    // rows would orphan their offers exactly once, on upgrade, for a
    // consistency gain nothing reads.
    it('reuses a pre-existing bare mapping rather than minting the canonical one', async () => {
      identifierMapping.getInternalId.mockImplementation((_t: string, externalId: string) =>
        Promise.resolve(externalId === 'WOBLACK100' ? 'ol_variant_legacy' : null),
      );

      const rows = await modelAdapter.listInventory(MODEL_PRODUCT_ID);

      expect(rows[0].variantId).toBe('ol_variant_legacy');
      expect(rows[1].variantId).toBe('ol_variant_WOBLACK50::variant');
    });

    it('getInventory reports the model TOTAL, not one member', async () => {
      const inventory = await modelAdapter.getInventory(MODEL_PRODUCT_ID);
      expect(inventory.quantity).toBe(517 + 516);
    });

    it('getAvailableQuantity sums every member', async () => {
      await expect(modelAdapter.getAvailableQuantity(MODEL_PRODUCT_ID)).resolves.toBe(517 + 516);
    });

    it('adjustInventory REFUSES without a variantId rather than picking a member', async () => {
      // Moving "the product's" stock is not a defined act for a model, and a
      // silent pick would move real stock on the wrong towar.
      await expect(
        modelAdapter.adjustInventory({ productId: MODEL_PRODUCT_ID, quantity: 5 }),
      ).rejects.toBeInstanceOf(SubiektConfigException);
      expect(bridge.adjust).not.toHaveBeenCalled();
    });

    it('adjustInventory targets the towar the variantId names', async () => {
      bridge.adjust.mockResolvedValue({ deduplicated: false, documentId: 1, documentNumber: 'PW 1/2026', stanAfter: 521 });
      await modelAdapter.adjustInventory({
        productId: MODEL_PRODUCT_ID,
        variantId: 'ol_variant_50',
        quantity: 5,
      });
      expect(bridge.adjust).toHaveBeenCalledWith(expect.objectContaining({ towarSymbol: 'WOBLACK50' }));
    });

    it('reports a host built with NO model reader as a wiring fault, never as empty stock', async () => {
      const unwired = new SubiektInventoryMasterAdapter(
        bridge as unknown as SubiektInventoryBridgeClient,
        identifierMapping,
        CONNECTION_ID,
        logger,
      );
      await expect(unwired.listInventory(MODEL_PRODUCT_ID)).rejects.toBeInstanceOf(SubiektConfigException);
    });

    it('treats a model whose every member is gone as a master-side deletion', async () => {
      const emptied = new SubiektInventoryMasterAdapter(
        bridge as unknown as SubiektInventoryBridgeClient,
        identifierMapping,
        CONNECTION_ID,
        logger,
        undefined,
        () => Promise.resolve([]),
      );
      await expect(emptied.listInventory(MODEL_PRODUCT_ID)).rejects.toBeInstanceOf(MasterProductNotFoundError);
    });
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
    it('should return exactly one product-level entry for a towar in NO model', async () => {
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
