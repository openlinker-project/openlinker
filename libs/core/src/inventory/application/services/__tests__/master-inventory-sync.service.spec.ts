/**
 * Master Inventory Sync Service Tests
 *
 * Unit tests for MasterInventorySyncService. Covers the list-from-master →
 * map-to-domain → upsert-canonical pipeline (one canonical row per variant,
 * #823), the available-quantity fallback derivation, inventory-item ID
 * preservation across upserts, the summed result shape, and failure-mode
 * propagation from each external collaborator, and the connection-ownership
 * guard (#1904) that withholds both prune paths when a second
 * InventoryMaster connection claims the same internal product id.
 *
 * Logger is left as-is (class-constructed in the service); the neutral
 * `@openlinker/shared/logging` console default handles output during tests.
 * Same precedent as `inventory-sync.service.spec.ts` — the only log assertions
 * are on the empty-response full-stale warn, where observability IS the
 * behaviour under test (spied via `Logger.prototype`, same as that file).
 *
 * @module libs/core/src/inventory/application/services/__tests__
 */

import { MasterInventorySyncService } from '../master-inventory-sync.service';
import type { IEntityClaimService, IIntegrationsService } from '@openlinker/core/integrations';
import type { IIdentifierMappingService } from '@openlinker/core/identifier-mapping';
import type { IInventoryService } from '../inventory.service.interface';
import type {
  InventoryMasterPort,
  Inventory as InventoryPortInterface,
} from '@openlinker/core/inventory';
import { InventoryItemEntity as InventoryItem } from '@openlinker/core/inventory';
import type { IProductsService, ProductVariant } from '@openlinker/core/products';
import { MasterProductNotFoundError } from '@openlinker/core/products';
import type { EventPublisherPort } from '@openlinker/core/events';
import { Logger } from '@openlinker/shared/logging';

describe('MasterInventorySyncService', () => {
  let service: MasterInventorySyncService;
  let integrationsService: jest.Mocked<IIntegrationsService>;
  let identifierMapping: jest.Mocked<IIdentifierMappingService>;
  let inventoryService: jest.Mocked<IInventoryService>;
  let inventoryAdapter: jest.Mocked<InventoryMasterPort>;
  let productsService: jest.Mocked<Pick<IProductsService, 'getVariantsByProductId'>>;
  let eventPublisher: jest.Mocked<EventPublisherPort>;
  let entityClaims: jest.Mocked<IEntityClaimService>;

  const connectionId = 'connection-123';
  const externalId = 'ext-product-9';
  const internalProductId = 'ol_product_abc';

  beforeEach(() => {
    inventoryAdapter = {
      getInventory: jest.fn(),
      listInventory: jest.fn(),
      adjustInventory: jest.fn(),
      reserveInventory: jest.fn(),
      releaseInventory: jest.fn(),
      getAvailableQuantity: jest.fn(),
    } as unknown as jest.Mocked<InventoryMasterPort>;

    integrationsService = {
      getCapabilityAdapter: jest.fn().mockResolvedValue(inventoryAdapter),
      getAdapter: jest.fn(),
      listCapabilityAdapters: jest.fn(),
    } as unknown as jest.Mocked<IIntegrationsService>;

    identifierMapping = {
      getOrCreateInternalId: jest.fn().mockResolvedValue(internalProductId),
      getInternalId: jest.fn(),
      getExternalIds: jest.fn(),
      createMapping: jest.fn(),
      batchGetOrCreateInternalIds: jest.fn(),
      getOrCreateExactMapping: jest.fn(),
      deleteMapping: jest.fn(),
      listExternalIdsByConnection: jest.fn(),
    } as unknown as jest.Mocked<IIdentifierMappingService>;

    inventoryService = {
      setInventory: jest.fn().mockImplementation((item: InventoryItem) => Promise.resolve(item)),
      getInventory: jest.fn().mockResolvedValue(null),
      pruneStaleVariants: jest.fn().mockResolvedValue({ markedCount: 0, variantIds: [] }),
    } as unknown as jest.Mocked<IInventoryService>;

    productsService = {
      // Default: no variants resolved ⇒ the resolveVariantId safety net yields
      // product-level (null) keying when the adapter omits a variantId.
      getVariantsByProductId: jest.fn().mockResolvedValue([]),
    };

    eventPublisher = {
      publish: jest.fn().mockResolvedValue('msg-1'),
    } as unknown as jest.Mocked<EventPublisherPort>;

    // Default: this connection is the only InventoryMaster claiming the internal
    // product id, so the ownership guard (#1904) never blocks the prune.
    entityClaims = {
      findRivalClaimants: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<IEntityClaimService>;

    service = new MasterInventorySyncService(
      integrationsService,
      identifierMapping,
      inventoryService,
      productsService as unknown as IProductsService,
      eventPublisher,
      entityClaims
    );
  });

  describe('syncFromMasterByExternalId', () => {
    it('should resolve external→internal ID and set canonical inventory when the adapter returns a complete inventory record', async () => {
      const adapterInventory: InventoryPortInterface = {
        id: 'adapter-inv-1',
        productId: internalProductId,
        variantId: 'var-1',
        locationId: 'loc-1',
        quantity: 12,
        reserved: 3,
        available: 9,
        updatedAt: new Date('2026-05-01T10:00:00Z'),
      };
      inventoryAdapter.listInventory.mockResolvedValue([adapterInventory]);

      const result = await service.syncFromMasterByExternalId(connectionId, externalId);

      expect(identifierMapping.getOrCreateInternalId).toHaveBeenCalledWith(
        'Product',
        externalId,
        connectionId
      );
      expect(integrationsService.getCapabilityAdapter).toHaveBeenCalledWith(
        connectionId,
        'InventoryMaster'
      );
      expect(inventoryAdapter.listInventory).toHaveBeenCalledWith(internalProductId);
      expect(inventoryService.setInventory).toHaveBeenCalledWith(
        expect.objectContaining({
          productId: internalProductId,
          productVariantId: 'var-1',
          availableQuantity: 9,
          reservedQuantity: 3,
          locationId: 'loc-1',
          updatedAt: adapterInventory.updatedAt,
        })
      );
      expect(result).toEqual({
        internalProductId,
        itemsWritten: 1,
        availableQuantity: 9,
        reservedQuantity: 3,
        masterDeleted: false,
        pruneSkipped: false,
      });
    });

    it('should write one canonical row per variant and sum the result for a multi-variant product', async () => {
      inventoryAdapter.listInventory.mockResolvedValue([
        {
          id: 'inv-a',
          productId: internalProductId,
          variantId: 'ol_variant_a',
          quantity: 10,
          reserved: 1,
          available: 9,
          updatedAt: new Date('2026-05-01T10:00:00Z'),
        },
        {
          id: 'inv-b',
          productId: internalProductId,
          variantId: 'ol_variant_b',
          quantity: 5,
          reserved: 0,
          available: 5,
          updatedAt: new Date('2026-05-01T10:00:00Z'),
        },
      ]);

      const result = await service.syncFromMasterByExternalId(connectionId, externalId);

      expect(inventoryService.setInventory).toHaveBeenCalledTimes(2);
      expect(inventoryService.setInventory).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ productVariantId: 'ol_variant_a', availableQuantity: 9 })
      );
      expect(inventoryService.setInventory).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ productVariantId: 'ol_variant_b', availableQuantity: 5 })
      );
      expect(result).toEqual({
        internalProductId,
        itemsWritten: 2,
        availableQuantity: 14,
        reservedQuantity: 1,
        masterDeleted: false,
        pruneSkipped: false,
      });
      // Adapter supplies the per-combination variantIds — no products-service fallback.
      expect(productsService.getVariantsByProductId).not.toHaveBeenCalled();
    });

    it('should derive availableQuantity from quantity minus reserved when the adapter omits available', async () => {
      const adapterInventory = {
        id: 'adapter-inv-2',
        productId: internalProductId,
        variantId: 'var-2',
        locationId: undefined,
        quantity: 20,
        reserved: 5,
        updatedAt: new Date('2026-05-01T10:00:00Z'),
        // available intentionally omitted — exercises the `?? (quantity - reserved)` fallback
      } as unknown as InventoryPortInterface;
      inventoryAdapter.listInventory.mockResolvedValue([adapterInventory]);

      const result = await service.syncFromMasterByExternalId(connectionId, externalId);

      expect(inventoryService.setInventory).toHaveBeenCalledWith(
        expect.objectContaining({
          availableQuantity: 15,
          reservedQuantity: 5,
        })
      );
      expect(result.availableQuantity).toBe(15);
      expect(result.reservedQuantity).toBe(5);
    });

    it('should preserve the existing inventory item ID when an InventoryItem already exists for the (product, variant, location)', async () => {
      const existing = new InventoryItem(
        'preserved-inv-id',
        internalProductId,
        'var-1',
        0,
        0,
        'loc-1',
        new Date('2026-04-01T00:00:00Z')
      );
      inventoryService.getInventory.mockResolvedValue(existing);
      inventoryAdapter.listInventory.mockResolvedValue([
        {
          id: 'adapter-inv-3',
          productId: internalProductId,
          variantId: 'var-1',
          locationId: 'loc-1',
          quantity: 12,
          reserved: 2,
          available: 10,
          updatedAt: new Date('2026-05-01T10:00:00Z'),
        },
      ]);

      await service.syncFromMasterByExternalId(connectionId, externalId);

      expect(inventoryService.getInventory).toHaveBeenCalledWith(
        internalProductId,
        'var-1',
        'loc-1'
      );
      expect(inventoryService.setInventory).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'preserved-inv-id' })
      );
    });

    it('should mint a fresh inventory item ID when no existing record matches', async () => {
      inventoryService.getInventory.mockResolvedValue(null);
      inventoryAdapter.listInventory.mockResolvedValue([
        {
          id: 'adapter-inv-4',
          productId: internalProductId,
          // no variantId / locationId — resolveVariantId safety net ⇒ null
          quantity: 5,
          reserved: 0,
          available: 5,
          updatedAt: new Date('2026-05-01T10:00:00Z'),
        } as unknown as InventoryPortInterface,
      ]);

      await service.syncFromMasterByExternalId(connectionId, externalId);

      expect(inventoryService.getInventory).toHaveBeenCalledWith(internalProductId, null, null);
      expect(inventoryService.setInventory).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.stringMatching(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
          ),
          productVariantId: null,
          locationId: null,
        })
      );
    });

    it('should default updatedAt to the current Date when the adapter omits it', async () => {
      inventoryAdapter.listInventory.mockResolvedValue([
        {
          id: 'adapter-inv-5',
          productId: internalProductId,
          variantId: 'var-5',
          quantity: 1,
          reserved: 0,
          available: 1,
          // updatedAt intentionally omitted
        } as unknown as InventoryPortInterface,
      ]);

      await service.syncFromMasterByExternalId(connectionId, externalId);

      expect(inventoryService.setInventory).toHaveBeenCalledWith(
        expect.objectContaining({ updatedAt: expect.any(Date) })
      );
    });

    it('should propagate identifierMapping.getOrCreateInternalId failures and skip downstream calls', async () => {
      const boom = new Error('identifier-mapping unavailable');
      identifierMapping.getOrCreateInternalId.mockRejectedValueOnce(boom);

      await expect(service.syncFromMasterByExternalId(connectionId, externalId)).rejects.toBe(boom);

      expect(integrationsService.getCapabilityAdapter).not.toHaveBeenCalled();
      expect(inventoryAdapter.listInventory).not.toHaveBeenCalled();
      expect(inventoryService.setInventory).not.toHaveBeenCalled();
    });

    it('should propagate getCapabilityAdapter failures when the connection does not support InventoryMaster', async () => {
      const boom = new Error('Capability InventoryMaster not supported by connection');
      integrationsService.getCapabilityAdapter.mockRejectedValueOnce(boom);

      await expect(service.syncFromMasterByExternalId(connectionId, externalId)).rejects.toBe(boom);

      expect(inventoryAdapter.listInventory).not.toHaveBeenCalled();
      expect(inventoryService.setInventory).not.toHaveBeenCalled();
    });

    it('should propagate adapter.listInventory failures and skip the canonical write', async () => {
      const boom = new Error('master inventory fetch failed');
      inventoryAdapter.listInventory.mockRejectedValueOnce(boom);

      await expect(service.syncFromMasterByExternalId(connectionId, externalId)).rejects.toBe(boom);

      expect(inventoryService.setInventory).not.toHaveBeenCalled();
      expect(inventoryService.pruneStaleVariants).not.toHaveBeenCalled();
    });
  });

  // Master deletion (#1688): when the InventoryMasterPort adapter's
  // `listInventory` throws the neutral MasterProductNotFoundError (adapters
  // translate their own platform 404 at the port boundary), the sync marks
  // every inventory row stale (empty keep-set), emits `master.product.stale`,
  // and reports `masterDeleted: true` — instead of letting the exception
  // propagate as a retryable transient failure. Mirrors the equivalent
  // `MasterProductSyncService` coverage.
  describe('master deletion (#1688)', () => {
    it('marks all rows stale, emits master.product.stale and reports masterDeleted on a not-found', async () => {
      inventoryAdapter.listInventory.mockRejectedValueOnce(
        new MasterProductNotFoundError(internalProductId, connectionId)
      );
      (inventoryService.pruneStaleVariants as jest.Mock).mockResolvedValueOnce({
        markedCount: 2,
        variantIds: ['ol_variant_1', 'ol_variant_2'],
      });

      const result = await service.syncFromMasterByExternalId(connectionId, externalId);

      // Empty keep-set ⇒ mark every known row for the product stale.
      expect(inventoryService.pruneStaleVariants).toHaveBeenCalledWith(internalProductId, []);
      expect(inventoryService.setInventory).not.toHaveBeenCalled();
      expect(eventPublisher.publish).toHaveBeenCalledWith(
        'events.master.deletion',
        expect.objectContaining({
          eventType: 'master.product.stale',
          payloadJson: JSON.stringify({
            connectionId,
            internalProductId,
            variantIds: ['ol_variant_1', 'ol_variant_2'],
          }),
        })
      );
      expect(result).toEqual({
        internalProductId,
        itemsWritten: 0,
        availableQuantity: 0,
        reservedQuantity: 0,
        masterDeleted: true,
        pruneSkipped: false,
      });
    });

    it('does not publish when the deletion prune flags no variant rows', async () => {
      inventoryAdapter.listInventory.mockRejectedValueOnce(
        new MasterProductNotFoundError(internalProductId, connectionId)
      );
      (inventoryService.pruneStaleVariants as jest.Mock).mockResolvedValueOnce({
        markedCount: 0,
        variantIds: [],
      });

      await service.syncFromMasterByExternalId(connectionId, externalId);

      expect(eventPublisher.publish).not.toHaveBeenCalled();
    });

    it('still publishes master.product.stale when the deletion marks a product-level (NULL-variant) row stale, even though variantIds stays empty (#1688)', async () => {
      inventoryAdapter.listInventory.mockRejectedValueOnce(
        new MasterProductNotFoundError(internalProductId, connectionId)
      );
      // Product-level rows contribute to markedCount but not variantIds (see
      // PruneStaleVariantsResult's doc comment) - the emission gate must key
      // off markedCount, or this case silently drops the event.
      (inventoryService.pruneStaleVariants as jest.Mock).mockResolvedValueOnce({
        markedCount: 1,
        variantIds: [],
      });

      await service.syncFromMasterByExternalId(connectionId, externalId);

      expect(eventPublisher.publish).toHaveBeenCalledWith(
        'events.master.deletion',
        expect.objectContaining({
          eventType: 'master.product.stale',
          payloadJson: JSON.stringify({ connectionId, internalProductId, variantIds: [] }),
        })
      );
    });

    it('rethrows a transient (non-not-found) adapter error unchanged', async () => {
      const boom = new Error('ECONNRESET');
      inventoryAdapter.listInventory.mockRejectedValueOnce(boom);

      await expect(service.syncFromMasterByExternalId(connectionId, externalId)).rejects.toBe(boom);

      expect(inventoryService.pruneStaleVariants).not.toHaveBeenCalled();
      expect(eventPublisher.publish).not.toHaveBeenCalled();
    });
  });

  // Stale-variant pruning (#1478): after writing the current master response,
  // the sync soft-marks any previously-known variant absent from it as stale.
  describe('stale-variant pruning', () => {
    it('prunes with the variant keys just written after the upsert loop', async () => {
      inventoryAdapter.listInventory.mockResolvedValue([
        {
          id: 'inv-a',
          productId: internalProductId,
          variantId: 'ol_variant_a',
          quantity: 10,
          reserved: 1,
          available: 9,
          updatedAt: new Date('2026-05-01T10:00:00Z'),
        },
        {
          id: 'inv-b',
          productId: internalProductId,
          variantId: 'ol_variant_b',
          quantity: 5,
          reserved: 0,
          available: 5,
          updatedAt: new Date('2026-05-01T10:00:00Z'),
        },
      ]);

      await service.syncFromMasterByExternalId(connectionId, externalId);

      expect(inventoryService.pruneStaleVariants).toHaveBeenCalledTimes(1);
      expect(inventoryService.pruneStaleVariants).toHaveBeenCalledWith(internalProductId, [
        'ol_variant_a',
        'ol_variant_b',
      ]);
    });

    it('prunes with an empty keep set when the master returns no inventory (product fully removed)', async () => {
      inventoryAdapter.listInventory.mockResolvedValue([]);

      await service.syncFromMasterByExternalId(connectionId, externalId);

      expect(inventoryService.setInventory).not.toHaveBeenCalled();
      expect(inventoryService.pruneStaleVariants).toHaveBeenCalledWith(internalProductId, []);
    });

    it('prunes with the resolved variant key (null) when the row keys product-level', async () => {
      inventoryAdapter.listInventory.mockResolvedValue([
        {
          id: 'inv-pl',
          productId: internalProductId,
          // no variantId — resolveVariantId safety net yields null (zero/many variants)
          quantity: 5,
          reserved: 0,
          available: 5,
          updatedAt: new Date('2026-05-01T10:00:00Z'),
        } as unknown as InventoryPortInterface,
      ]);

      await service.syncFromMasterByExternalId(connectionId, externalId);

      expect(inventoryService.pruneStaleVariants).toHaveBeenCalledWith(internalProductId, [null]);
    });

    it('publishes master.variant.stale when the prune flags variant rows (#1599)', async () => {
      inventoryAdapter.listInventory.mockResolvedValue([]);
      (inventoryService.pruneStaleVariants as jest.Mock).mockResolvedValueOnce({
        markedCount: 2,
        variantIds: ['ol_variant_gone'],
      });

      await service.syncFromMasterByExternalId(connectionId, externalId);

      expect(eventPublisher.publish).toHaveBeenCalledWith(
        'events.master.deletion',
        expect.objectContaining({
          eventType: 'master.variant.stale',
          payloadJson: JSON.stringify({
            connectionId,
            internalProductId,
            variantIds: ['ol_variant_gone'],
          }),
        })
      );
    });

    it('still publishes master.variant.stale when the prune marks a product-level (NULL-variant) row stale, even though variantIds stays empty (#1688)', async () => {
      inventoryAdapter.listInventory.mockResolvedValue([]);
      (inventoryService.pruneStaleVariants as jest.Mock).mockResolvedValueOnce({
        markedCount: 1,
        variantIds: [],
      });

      await service.syncFromMasterByExternalId(connectionId, externalId);

      expect(eventPublisher.publish).toHaveBeenCalledWith(
        'events.master.deletion',
        expect.objectContaining({
          eventType: 'master.variant.stale',
          payloadJson: JSON.stringify({ connectionId, internalProductId, variantIds: [] }),
        })
      );
    });

    it('does not publish when the prune flags no variant rows', async () => {
      inventoryAdapter.listInventory.mockResolvedValue([]);
      (inventoryService.pruneStaleVariants as jest.Mock).mockResolvedValueOnce({
        markedCount: 0,
        variantIds: [],
      });

      await service.syncFromMasterByExternalId(connectionId, externalId);

      expect(eventPublisher.publish).not.toHaveBeenCalled();
    });

    // The unconditional prune is intentionally asymmetric with the products
    // context (which skips its prune on a successful-but-empty pull). That
    // asymmetry must not be SILENT: an empty master response that stales every
    // known row still reports masterDeleted=false / outcome='ok', so the warn is
    // the only operator-visible trace of a full stale.
    it('warns when an empty master response stales rows while reporting masterDeleted=false', async () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      inventoryAdapter.listInventory.mockResolvedValue([]);
      (inventoryService.pruneStaleVariants as jest.Mock).mockResolvedValueOnce({
        markedCount: 3,
        variantIds: ['ol_variant_a'],
      });

      const result = await service.syncFromMasterByExternalId(connectionId, externalId);

      expect(result.masterDeleted).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('master_inventory_empty_response_full_stale')
      );
      warnSpy.mockRestore();
    });

    it('does not warn about a full stale when the master returned rows', async () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      inventoryAdapter.listInventory.mockResolvedValue([
        {
          id: 'inv-1',
          productId: internalProductId,
          variantId: 'ol_variant_a',
          quantity: 4,
          reserved: 0,
          available: 4,
          updatedAt: new Date('2026-05-01T10:00:00Z'),
        } as unknown as InventoryPortInterface,
      ]);
      (inventoryService.pruneStaleVariants as jest.Mock).mockResolvedValueOnce({
        markedCount: 1,
        variantIds: ['ol_variant_gone'],
      });

      await service.syncFromMasterByExternalId(connectionId, externalId);

      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('master_inventory_empty_response_full_stale')
      );
      warnSpy.mockRestore();
    });

    it('does not warn when an empty master response stales nothing', async () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      inventoryAdapter.listInventory.mockResolvedValue([]);
      (inventoryService.pruneStaleVariants as jest.Mock).mockResolvedValueOnce({
        markedCount: 0,
        variantIds: [],
      });

      await service.syncFromMasterByExternalId(connectionId, externalId);

      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('master_inventory_empty_response_full_stale')
      );
      warnSpy.mockRestore();
    });
  });

  // Safety-net variant resolution (#822): when an adapter returns an Inventory
  // WITHOUT a variantId, the sync resolves it via the products service. Since
  // #823 the PrestaShop adapter supplies variantId per entry, so this path is
  // the fallback for adapters that don't. Log assertions omitted per this
  // file's logger-as-is precedent.
  describe('variant resolution safety net', () => {
    const makeVariant = (id: string): ProductVariant => ({
      id,
      productId: internalProductId,
      sku: null,
      attributes: null,
      ean: null,
      gtin: null,
    });

    // An adapter that returns product-level stock with no variantId.
    const productLevelInventory: InventoryPortInterface = {
      id: 'adapter-inv',
      productId: internalProductId,
      quantity: 50,
      reserved: 0,
      available: 50,
      updatedAt: new Date('2026-05-01T10:00:00Z'),
    };

    it('keys inventory to the sole variant when the product has exactly one', async () => {
      inventoryAdapter.listInventory.mockResolvedValue([productLevelInventory]);
      productsService.getVariantsByProductId.mockResolvedValue([makeVariant('ol_variant_a')]);

      await service.syncFromMasterByExternalId(connectionId, externalId);

      expect(productsService.getVariantsByProductId).toHaveBeenCalledWith(internalProductId);
      expect(inventoryService.getInventory).toHaveBeenCalledWith(
        internalProductId,
        'ol_variant_a',
        null
      );
      expect(inventoryService.setInventory).toHaveBeenCalledWith(
        expect.objectContaining({ productVariantId: 'ol_variant_a' })
      );
    });

    it('keeps inventory product-level (null) when the product has multiple variants', async () => {
      inventoryAdapter.listInventory.mockResolvedValue([productLevelInventory]);
      productsService.getVariantsByProductId.mockResolvedValue([
        makeVariant('ol_variant_a'),
        makeVariant('ol_variant_b'),
      ]);

      await service.syncFromMasterByExternalId(connectionId, externalId);

      expect(inventoryService.setInventory).toHaveBeenCalledWith(
        expect.objectContaining({ productVariantId: null })
      );
    });

    it('uses an adapter-supplied variantId verbatim without resolving variants', async () => {
      inventoryAdapter.listInventory.mockResolvedValue([
        { ...productLevelInventory, variantId: 'ol_variant_adapter' },
      ]);

      await service.syncFromMasterByExternalId(connectionId, externalId);

      expect(productsService.getVariantsByProductId).not.toHaveBeenCalled();
      expect(inventoryService.setInventory).toHaveBeenCalledWith(
        expect.objectContaining({ productVariantId: 'ol_variant_adapter' })
      );
    });
  });

  // Connection-ownership guard (#1904): the prune keys on internalProductId
  // alone, so it is withheld whenever a SECOND connection with InventoryMaster
  // enabled also claims that id - otherwise one master's not-found (or partial
  // response) would stale rows the sibling still considers live.
  describe('rival-master ownership guard (#1904)', () => {
    const rival = 'connection-rival';

    it('queries the claim service scoped to the product id, the InventoryMaster capability and this connection', async () => {
      inventoryAdapter.listInventory.mockResolvedValue([]);

      await service.syncFromMasterByExternalId(connectionId, externalId);

      expect(entityClaims.findRivalClaimants).toHaveBeenCalledWith({
        entityType: 'Product',
        internalId: internalProductId,
        capability: 'InventoryMaster',
        excludeConnectionId: connectionId,
      });
    });

    it('skips the partial prune, emits no event and reports pruneSkipped when a rival InventoryMaster claims the same product id', async () => {
      inventoryAdapter.listInventory.mockResolvedValue([
        {
          id: 'inv-a',
          productId: internalProductId,
          variantId: 'ol_variant_a',
          quantity: 4,
          reserved: 0,
          available: 4,
          updatedAt: new Date('2026-05-01T10:00:00Z'),
        },
      ]);
      entityClaims.findRivalClaimants.mockResolvedValue([rival]);

      const result = await service.syncFromMasterByExternalId(connectionId, externalId);

      // Canonical writes still run - only the destructive sweep is withheld.
      expect(inventoryService.setInventory).toHaveBeenCalledTimes(1);
      expect(inventoryService.pruneStaleVariants).not.toHaveBeenCalled();
      expect(eventPublisher.publish).not.toHaveBeenCalled();
      expect(result).toEqual({
        internalProductId,
        itemsWritten: 1,
        availableQuantity: 4,
        reservedQuantity: 0,
        masterDeleted: false,
        pruneSkipped: true,
      });
    });

    it('skips the deletion prune, emits no event and still reports masterDeleted when a rival InventoryMaster claims the same product id', async () => {
      inventoryAdapter.listInventory.mockRejectedValueOnce(
        new MasterProductNotFoundError(internalProductId, connectionId)
      );
      entityClaims.findRivalClaimants.mockResolvedValue([rival]);

      const result = await service.syncFromMasterByExternalId(connectionId, externalId);

      expect(inventoryService.pruneStaleVariants).not.toHaveBeenCalled();
      expect(eventPublisher.publish).not.toHaveBeenCalled();
      expect(result).toEqual({
        internalProductId,
        itemsWritten: 0,
        availableQuantity: 0,
        reservedQuantity: 0,
        masterDeleted: true,
        pruneSkipped: true,
      });
    });
  });
});
