/**
 * Master Inventory Sync Service Tests
 *
 * Unit tests for MasterInventorySyncService. Covers the read-from-master →
 * map-to-domain → upsert-canonical pipeline, the available-quantity fallback
 * derivation, inventory-item ID preservation across upserts, and failure-mode
 * propagation from each external collaborator.
 *
 * Logger is left as-is (class-constructed at line 29 of the service); the
 * neutral `@openlinker/shared/logging` console default handles output during
 * tests. Same precedent as `inventory-sync.service.spec.ts`.
 *
 * @module libs/core/src/inventory/application/services/__tests__
 */

import { MasterInventorySyncService } from '../master-inventory-sync.service';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { IIdentifierMappingService } from '@openlinker/core/identifier-mapping';
import type { IInventoryService } from '../inventory.service.interface';
import type {
  InventoryMasterPort,
  Inventory as InventoryPortInterface,
} from '../../../domain/ports/inventory-master.port';
import { InventoryItem } from '../../../domain/entities/inventory-item.entity';

describe('MasterInventorySyncService', () => {
  let service: MasterInventorySyncService;
  let integrationsService: jest.Mocked<IIntegrationsService>;
  let identifierMapping: jest.Mocked<IIdentifierMappingService>;
  let inventoryService: jest.Mocked<IInventoryService>;
  let inventoryAdapter: jest.Mocked<InventoryMasterPort>;

  const connectionId = 'connection-123';
  const externalId = 'ext-product-9';
  const internalProductId = 'ol_product_abc';

  beforeEach(() => {
    inventoryAdapter = {
      getInventory: jest.fn(),
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
    } as unknown as jest.Mocked<IInventoryService>;

    service = new MasterInventorySyncService(
      integrationsService,
      identifierMapping,
      inventoryService,
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
      inventoryAdapter.getInventory.mockResolvedValue(adapterInventory);

      const result = await service.syncFromMasterByExternalId(connectionId, externalId);

      expect(identifierMapping.getOrCreateInternalId).toHaveBeenCalledWith(
        'Product',
        externalId,
        connectionId,
      );
      expect(integrationsService.getCapabilityAdapter).toHaveBeenCalledWith(
        connectionId,
        'InventoryMaster',
      );
      expect(inventoryAdapter.getInventory).toHaveBeenCalledWith(internalProductId, undefined);
      expect(inventoryService.setInventory).toHaveBeenCalledWith(
        expect.objectContaining({
          productId: internalProductId,
          productVariantId: 'var-1',
          availableQuantity: 9,
          reservedQuantity: 3,
          locationId: 'loc-1',
          updatedAt: adapterInventory.updatedAt,
        }),
      );
      expect(result).toEqual({
        internalProductId,
        availableQuantity: 9,
        reservedQuantity: 3,
      });
    });

    it('should derive availableQuantity from quantity minus reserved when the adapter omits available', async () => {
      const adapterInventory = {
        id: 'adapter-inv-2',
        productId: internalProductId,
        variantId: undefined,
        locationId: undefined,
        quantity: 20,
        reserved: 5,
        updatedAt: new Date('2026-05-01T10:00:00Z'),
        // available intentionally omitted — exercises the `?? (quantity - reserved)` fallback
      } as unknown as InventoryPortInterface;
      inventoryAdapter.getInventory.mockResolvedValue(adapterInventory);

      const result = await service.syncFromMasterByExternalId(connectionId, externalId);

      expect(inventoryService.setInventory).toHaveBeenCalledWith(
        expect.objectContaining({
          availableQuantity: 15,
          reservedQuantity: 5,
        }),
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
        new Date('2026-04-01T00:00:00Z'),
      );
      inventoryService.getInventory.mockResolvedValue(existing);
      inventoryAdapter.getInventory.mockResolvedValue({
        id: 'adapter-inv-3',
        productId: internalProductId,
        variantId: 'var-1',
        locationId: 'loc-1',
        quantity: 12,
        reserved: 2,
        available: 10,
        updatedAt: new Date('2026-05-01T10:00:00Z'),
      });

      await service.syncFromMasterByExternalId(connectionId, externalId);

      expect(inventoryService.getInventory).toHaveBeenCalledWith(internalProductId, 'var-1', 'loc-1');
      expect(inventoryService.setInventory).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'preserved-inv-id' }),
      );
    });

    it('should mint a fresh inventory item ID when no existing record matches', async () => {
      inventoryService.getInventory.mockResolvedValue(null);
      inventoryAdapter.getInventory.mockResolvedValue({
        id: 'adapter-inv-4',
        productId: internalProductId,
        // no variantId / locationId — both null in the getInventory lookup
        quantity: 5,
        reserved: 0,
        available: 5,
        updatedAt: new Date('2026-05-01T10:00:00Z'),
      });

      await service.syncFromMasterByExternalId(connectionId, externalId);

      expect(inventoryService.getInventory).toHaveBeenCalledWith(internalProductId, null, null);
      expect(inventoryService.setInventory).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.stringMatching(/^[0-9a-f-]{36}$/i),
          productVariantId: null,
          locationId: null,
        }),
      );
    });

    it('should default updatedAt to the current Date when the adapter omits it', async () => {
      inventoryAdapter.getInventory.mockResolvedValue({
        id: 'adapter-inv-5',
        productId: internalProductId,
        quantity: 1,
        reserved: 0,
        available: 1,
        // updatedAt intentionally omitted
      } as unknown as InventoryPortInterface);

      await service.syncFromMasterByExternalId(connectionId, externalId);

      expect(inventoryService.setInventory).toHaveBeenCalledWith(
        expect.objectContaining({ updatedAt: expect.any(Date) }),
      );
    });

    it('should propagate identifierMapping.getOrCreateInternalId failures and skip downstream calls', async () => {
      const boom = new Error('identifier-mapping unavailable');
      identifierMapping.getOrCreateInternalId.mockRejectedValueOnce(boom);

      await expect(
        service.syncFromMasterByExternalId(connectionId, externalId),
      ).rejects.toBe(boom);

      expect(integrationsService.getCapabilityAdapter).not.toHaveBeenCalled();
      expect(inventoryAdapter.getInventory).not.toHaveBeenCalled();
      expect(inventoryService.setInventory).not.toHaveBeenCalled();
    });

    it('should propagate getCapabilityAdapter failures when the connection does not support InventoryMaster', async () => {
      const boom = new Error('Capability InventoryMaster not supported by connection');
      integrationsService.getCapabilityAdapter.mockRejectedValueOnce(boom);

      await expect(
        service.syncFromMasterByExternalId(connectionId, externalId),
      ).rejects.toBe(boom);

      expect(inventoryAdapter.getInventory).not.toHaveBeenCalled();
      expect(inventoryService.setInventory).not.toHaveBeenCalled();
    });

    it('should propagate adapter.getInventory failures and skip the canonical write', async () => {
      const boom = new Error('master inventory fetch failed');
      inventoryAdapter.getInventory.mockRejectedValueOnce(boom);

      await expect(
        service.syncFromMasterByExternalId(connectionId, externalId),
      ).rejects.toBe(boom);

      expect(inventoryService.setInventory).not.toHaveBeenCalled();
    });
  });
});
