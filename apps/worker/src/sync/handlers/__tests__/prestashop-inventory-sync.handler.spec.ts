/**
 * PrestaShop Inventory Sync Handler Unit Tests
 *
 * Unit tests for PrestashopInventorySyncHandler, verifying inventory sync workflow,
 * error handling, and domain entity conversion.
 *
 * @module apps/worker/src/sync/handlers
 */
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { PrestashopInventorySyncHandler } from '../prestashop-inventory-sync.handler';
import { SyncJob } from '@openlinker/core/sync/domain/entities/sync-job.entity';
import { SyncJobExecutionError } from '@openlinker/core/sync/domain/exceptions/sync-job-execution.error';
import { IIntegrationsService } from '@openlinker/core/integrations/application/interfaces/integrations.service.interface';
import { INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations/integrations.tokens';
import { IIdentifierMappingService } from '@openlinker/core/identifier-mapping/application/services/identifier-mapping.service.interface';
import { IDENTIFIER_MAPPING_SERVICE_TOKEN } from '@openlinker/core/identifier-mapping/identifier-mapping.tokens';
import {
  IInventoryService,
  INVENTORY_SERVICE_TOKEN,
  InventoryMasterPort,
  Inventory as InventoryPortInterface,
} from '@openlinker/core/inventory';
import {
  PrestashopResourceNotFoundException,
  PrestashopAuthenticationException,
} from '@openlinker/integrations-prestashop';
import { randomUUID } from 'crypto';

describe('PrestashopInventorySyncHandler', () => {
  let handler: PrestashopInventorySyncHandler;
  let integrationsService: jest.Mocked<IIntegrationsService>;
  let identifierMapping: jest.Mocked<IIdentifierMappingService>;
  let inventoryService: jest.Mocked<IInventoryService>;
  let inventoryAdapter: jest.Mocked<InventoryMasterPort>;
  let module: TestingModule;

  beforeEach(async () => {
    // Mock inventory adapter
    inventoryAdapter = {
      getInventory: jest.fn(),
      adjustInventory: jest.fn(),
      reserveInventory: jest.fn(),
      releaseInventory: jest.fn(),
      getAvailableQuantity: jest.fn(),
    } as unknown as jest.Mocked<InventoryMasterPort>;

    // Mock integrations service
    const mockIntegrationsService = {
      getCapabilityAdapter: jest.fn().mockResolvedValue(inventoryAdapter),
    } as unknown as jest.Mocked<IIntegrationsService>;

    // Mock identifier mapping service
    const mockIdentifierMapping = {
      getOrCreateInternalId: jest.fn(),
      getExternalId: jest.fn(),
    } as unknown as jest.Mocked<IIdentifierMappingService>;

    // Mock inventory service
    const mockInventoryService = {
      getInventory: jest.fn(),
      setInventory: jest.fn(),
      adjustInventory: jest.fn(),
      reserveInventory: jest.fn(),
      releaseInventory: jest.fn(),
    } as unknown as jest.Mocked<IInventoryService>;

    module = await Test.createTestingModule({
      providers: [
        PrestashopInventorySyncHandler,
        {
          provide: INTEGRATIONS_SERVICE_TOKEN,
          useValue: mockIntegrationsService,
        },
        {
          provide: IDENTIFIER_MAPPING_SERVICE_TOKEN,
          useValue: mockIdentifierMapping,
        },
        {
          provide: INVENTORY_SERVICE_TOKEN,
          useValue: mockInventoryService,
        },
      ],
    }).compile();

    handler = module.get<PrestashopInventorySyncHandler>(PrestashopInventorySyncHandler);
    integrationsService = module.get(INTEGRATIONS_SERVICE_TOKEN);
    identifierMapping = module.get(IDENTIFIER_MAPPING_SERVICE_TOKEN);
    inventoryService = module.get(INVENTORY_SERVICE_TOKEN);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    // Close the testing module to trigger OnModuleDestroy on all providers
    if (module) {
      await module.close();
    }
  });

  const createMockJob = (overrides?: Partial<SyncJob>): SyncJob => {
    return new SyncJob(
      randomUUID(),
      'prestashop.inventory.syncByExternalId',
      randomUUID(),
      {
        externalId: '1',
        objectType: 'Product',
        eventType: 'inventory.updated',
        ...overrides?.payload,
      },
      'running',
      `test-key-${randomUUID()}`,
      0,
      10,
      new Date(),
      new Date(),
      'worker-123',
      null,
      new Date(),
      new Date(),
    );
  };

  const createMockInventoryPort = (
    overrides?: Partial<InventoryPortInterface>,
  ): InventoryPortInterface => {
    return {
      id: `ol_inventory_${randomUUID()}`,
      productId: `ol_product_${randomUUID()}`,
      variantId: undefined,
      locationId: undefined,
      quantity: 100,
      reserved: 10,
      available: 90,
      updatedAt: new Date(),
      ...overrides,
    };
  };

  describe('execute', () => {
    it('should sync inventory successfully', async () => {
      const job = createMockJob();
      const internalProductId = `ol_product_${randomUUID()}`;
      const inventoryPort = createMockInventoryPort({ productId: internalProductId });

      identifierMapping.getOrCreateInternalId.mockResolvedValueOnce(internalProductId);
      inventoryAdapter.getInventory.mockResolvedValueOnce(inventoryPort);
      inventoryService.getInventory.mockResolvedValueOnce(null); // No existing inventory
      inventoryService.setInventory.mockResolvedValueOnce({
        id: randomUUID(),
        productId: internalProductId,
        productVariantId: null,
        availableQuantity: 90,
        reservedQuantity: 10,
        locationId: null,
        updatedAt: new Date(),
      } as any);

      await handler.execute(job);

      expect(identifierMapping.getOrCreateInternalId).toHaveBeenCalledWith(
        'Product',
        '1',
        job.connectionId,
      );
      expect(integrationsService.getCapabilityAdapter).toHaveBeenCalledWith(
        job.connectionId,
        'InventoryMaster',
      );
      expect(inventoryAdapter.getInventory).toHaveBeenCalledWith(internalProductId, undefined);
      expect(inventoryService.getInventory).toHaveBeenCalledWith(
        internalProductId,
        null,
        null,
      );
      expect(inventoryService.setInventory).toHaveBeenCalled();
    });

    it('should use existing inventory ID when inventory already exists', async () => {
      const job = createMockJob();
      const internalProductId = `ol_product_${randomUUID()}`;
      const existingInventoryId = `ol_inventory_${randomUUID()}`;
      const inventoryPort = createMockInventoryPort({ productId: internalProductId });

      const existingInventory = {
        id: existingInventoryId,
        productId: internalProductId,
        productVariantId: null,
        availableQuantity: 50,
        reservedQuantity: 5,
        locationId: null,
        updatedAt: new Date(),
      };

      identifierMapping.getOrCreateInternalId.mockResolvedValueOnce(internalProductId);
      inventoryAdapter.getInventory.mockResolvedValueOnce(inventoryPort);
      inventoryService.getInventory.mockResolvedValueOnce(existingInventory as any);
      inventoryService.setInventory.mockResolvedValueOnce({
        id: randomUUID(),
        productId: internalProductId,
        productVariantId: null,
        availableQuantity: 90,
        reservedQuantity: 10,
        locationId: null,
        updatedAt: new Date(),
      } as any);

      await handler.execute(job);

      const setInventoryCall = inventoryService.setInventory.mock.calls[0][0];
      expect(setInventoryCall.id).toBe(existingInventoryId); // Uses existing ID
    });

    it('should handle inventory with variant ID', async () => {
      const job = createMockJob();
      const internalProductId = `ol_product_${randomUUID()}`;
      const variantId = `ol_variant_${randomUUID()}`;
      const inventoryPort = createMockInventoryPort({
        productId: internalProductId,
        variantId,
      });

      identifierMapping.getOrCreateInternalId.mockResolvedValueOnce(internalProductId);
      inventoryAdapter.getInventory.mockResolvedValueOnce(inventoryPort);
      inventoryService.getInventory.mockResolvedValueOnce(null);
      inventoryService.setInventory.mockResolvedValueOnce({
        id: randomUUID(),
        productId: internalProductId,
        productVariantId: null,
        availableQuantity: 90,
        reservedQuantity: 10,
        locationId: null,
        updatedAt: new Date(),
      } as any);

      await handler.execute(job);

      expect(inventoryService.getInventory).toHaveBeenCalledWith(
        internalProductId,
        variantId,
        null,
      );
      const setInventoryCall = inventoryService.setInventory.mock.calls[0][0];
      expect(setInventoryCall.productVariantId).toBe(variantId);
    });

    it('should handle inventory with location ID', async () => {
      const job = createMockJob();
      const internalProductId = `ol_product_${randomUUID()}`;
      const locationId = 'warehouse-1';
      const inventoryPort = createMockInventoryPort({
        productId: internalProductId,
        locationId,
      });

      identifierMapping.getOrCreateInternalId.mockResolvedValueOnce(internalProductId);
      inventoryAdapter.getInventory.mockResolvedValueOnce(inventoryPort);
      inventoryService.getInventory.mockResolvedValueOnce(null);
      inventoryService.setInventory.mockResolvedValueOnce({
        id: randomUUID(),
        productId: internalProductId,
        productVariantId: null,
        availableQuantity: 90,
        reservedQuantity: 10,
        locationId: null,
        updatedAt: new Date(),
      } as any);

      await handler.execute(job);

      expect(inventoryService.getInventory).toHaveBeenCalledWith(
        internalProductId,
        null,
        locationId,
      );
      const setInventoryCall = inventoryService.setInventory.mock.calls[0][0];
      expect(setInventoryCall.locationId).toBe(locationId);
    });

    it('should accept objectType "Product"', async () => {
      const job = createMockJob({ payload: { externalId: '1', objectType: 'Product' } });
      const internalProductId = `ol_product_${randomUUID()}`;
      const inventoryPort = createMockInventoryPort({ productId: internalProductId });

      identifierMapping.getOrCreateInternalId.mockResolvedValueOnce(internalProductId);
      inventoryAdapter.getInventory.mockResolvedValueOnce(inventoryPort);
      inventoryService.getInventory.mockResolvedValueOnce(null);
      inventoryService.setInventory.mockResolvedValueOnce({
        id: randomUUID(),
        productId: internalProductId,
        productVariantId: null,
        availableQuantity: 90,
        reservedQuantity: 10,
        locationId: null,
        updatedAt: new Date(),
      } as any);

      await handler.execute(job);

      expect(inventoryService.setInventory).toHaveBeenCalled();
    });

    it('should accept objectType "Inventory"', async () => {
      const job = createMockJob({ payload: { externalId: '1', objectType: 'Inventory' } });
      const internalProductId = `ol_product_${randomUUID()}`;
      const inventoryPort = createMockInventoryPort({ productId: internalProductId });

      identifierMapping.getOrCreateInternalId.mockResolvedValueOnce(internalProductId);
      inventoryAdapter.getInventory.mockResolvedValueOnce(inventoryPort);
      inventoryService.getInventory.mockResolvedValueOnce(null);
      inventoryService.setInventory.mockResolvedValueOnce({
        id: randomUUID(),
        productId: internalProductId,
        productVariantId: null,
        availableQuantity: 90,
        reservedQuantity: 10,
        locationId: null,
        updatedAt: new Date(),
      } as any);

      await handler.execute(job);

      expect(inventoryService.setInventory).toHaveBeenCalled();
    });

    it('should throw error when externalId is missing', async () => {
      const job = createMockJob({ payload: { externalId: undefined, objectType: 'Product' } }); // Missing externalId

      await expect(handler.execute(job)).rejects.toThrow(SyncJobExecutionError);
      await expect(handler.execute(job)).rejects.toThrow(/Missing or invalid externalId/);
    });

    it('should throw error when objectType is invalid', async () => {
      const job = createMockJob({ payload: { externalId: '1', objectType: 'Order' } });

      await expect(handler.execute(job)).rejects.toThrow(SyncJobExecutionError);
      await expect(handler.execute(job)).rejects.toThrow(
        "Invalid objectType for inventory sync: Order. Expected 'Inventory' or 'Product'.",
      );
    });

    it('should handle PrestashopResourceNotFoundException (404)', async () => {
      const job = createMockJob();
      const internalProductId = `ol_product_${randomUUID()}`;
      const error = new PrestashopResourceNotFoundException('Inventory not found');

      identifierMapping.getOrCreateInternalId.mockResolvedValueOnce(internalProductId);
      inventoryAdapter.getInventory.mockRejectedValueOnce(error);

      await expect(handler.execute(job)).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringMatching(/Inventory not found/),
        }),
      );
    });

    it('should handle PrestashopAuthenticationException (401)', async () => {
      const job = createMockJob();
      const internalProductId = `ol_product_${randomUUID()}`;
      const error = new PrestashopAuthenticationException('Invalid API key');

      identifierMapping.getOrCreateInternalId.mockResolvedValueOnce(internalProductId);
      inventoryAdapter.getInventory.mockRejectedValueOnce(error);

      await expect(handler.execute(job)).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringMatching(/Authentication failed/),
        }),
      );
    });

    it('should handle generic errors and wrap in SyncJobExecutionError', async () => {
      const job = createMockJob();
      const internalProductId = `ol_product_${randomUUID()}`;
      const error = new Error('Network timeout');

      identifierMapping.getOrCreateInternalId.mockResolvedValueOnce(internalProductId);
      inventoryAdapter.getInventory.mockRejectedValueOnce(error);

      await expect(handler.execute(job)).rejects.toThrow(SyncJobExecutionError);
      await expect(handler.execute(job)).rejects.toThrow('Inventory sync failed');
    });

    it('should calculate availableQuantity from available field', async () => {
      const job = createMockJob();
      const internalProductId = `ol_product_${randomUUID()}`;
      const inventoryPort = createMockInventoryPort({
        productId: internalProductId,
        available: 75,
        quantity: 100,
        reserved: 10,
      });

      identifierMapping.getOrCreateInternalId.mockResolvedValueOnce(internalProductId);
      inventoryAdapter.getInventory.mockResolvedValueOnce(inventoryPort);
      inventoryService.getInventory.mockResolvedValueOnce(null);
      inventoryService.setInventory.mockResolvedValueOnce({
        id: randomUUID(),
        productId: internalProductId,
        productVariantId: null,
        availableQuantity: 90,
        reservedQuantity: 10,
        locationId: null,
        updatedAt: new Date(),
      } as any);

      await handler.execute(job);

      const setInventoryCall = inventoryService.setInventory.mock.calls[0][0];
      expect(setInventoryCall.availableQuantity).toBe(75); // Uses available field
    });

    it('should calculate availableQuantity from quantity - reserved when available is missing', async () => {
      const job = createMockJob();
      const internalProductId = `ol_product_${randomUUID()}`;
      const inventoryPort = createMockInventoryPort({
        productId: internalProductId,
        available: undefined,
        quantity: 100,
        reserved: 10,
      });

      identifierMapping.getOrCreateInternalId.mockResolvedValueOnce(internalProductId);
      inventoryAdapter.getInventory.mockResolvedValueOnce(inventoryPort);
      inventoryService.getInventory.mockResolvedValueOnce(null);
      inventoryService.setInventory.mockResolvedValueOnce({
        id: randomUUID(),
        productId: internalProductId,
        productVariantId: null,
        availableQuantity: 90,
        reservedQuantity: 10,
        locationId: null,
        updatedAt: new Date(),
      } as any);

      await handler.execute(job);

      const setInventoryCall = inventoryService.setInventory.mock.calls[0][0];
      expect(setInventoryCall.availableQuantity).toBe(90); // 100 - 10
    });

    it('should handle null quantity and reserved with defaults', async () => {
      const job = createMockJob();
      const internalProductId = `ol_product_${randomUUID()}`;
      const inventoryPort = createMockInventoryPort({
        productId: internalProductId,
        available: undefined,
        quantity: null as any,
        reserved: null as any,
      });

      identifierMapping.getOrCreateInternalId.mockResolvedValueOnce(internalProductId);
      inventoryAdapter.getInventory.mockResolvedValueOnce(inventoryPort);
      inventoryService.getInventory.mockResolvedValueOnce(null);
      inventoryService.setInventory.mockResolvedValueOnce({
        id: randomUUID(),
        productId: internalProductId,
        productVariantId: null,
        availableQuantity: 90,
        reservedQuantity: 10,
        locationId: null,
        updatedAt: new Date(),
      } as any);

      await handler.execute(job);

      const setInventoryCall = inventoryService.setInventory.mock.calls[0][0];
      expect(setInventoryCall.availableQuantity).toBe(0); // 0 - 0 (defaults)
      expect(setInventoryCall.reservedQuantity).toBe(0); // Default
    });
  });

  describe('toDomainInventoryItem', () => {
    it('should generate new ID when inventory does not exist', async () => {
      const inventoryPort = createMockInventoryPort();
      const productId = `ol_product_${randomUUID()}`;

      inventoryService.getInventory.mockResolvedValueOnce(null);

      const result = await (handler as any).toDomainInventoryItem(inventoryPort, productId);

      expect(result.id).toBeDefined();
      expect(result.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      expect(result.productId).toBe(productId);
    });

    it('should use existing ID when inventory exists', async () => {
      const inventoryPort = createMockInventoryPort();
      const productId = `ol_product_${randomUUID()}`;
      const existingId = `ol_inventory_${randomUUID()}`;

      const existingInventory = {
        id: existingId,
        productId,
        productVariantId: null,
        availableQuantity: 50,
        reservedQuantity: 5,
        locationId: null,
        updatedAt: new Date(),
      };

      inventoryService.getInventory.mockResolvedValueOnce(existingInventory as any);

      const result = await (handler as any).toDomainInventoryItem(inventoryPort, productId);

      expect(result.id).toBe(existingId);
    });

    it('should map inventory fields correctly', async () => {
      const inventoryPort = createMockInventoryPort({
        variantId: `ol_variant_${randomUUID()}`,
        locationId: 'warehouse-1',
        available: 75,
        reserved: 10,
      });
      const productId = `ol_product_${randomUUID()}`;

      inventoryService.getInventory.mockResolvedValueOnce(null);

      const result = await (handler as any).toDomainInventoryItem(inventoryPort, productId);

      expect(result.productId).toBe(productId);
      expect(result.productVariantId).toBe(inventoryPort.variantId);
      expect(result.locationId).toBe(inventoryPort.locationId);
      expect(result.availableQuantity).toBe(75);
      expect(result.reservedQuantity).toBe(10);
    });

    it('should handle null variantId and locationId', async () => {
      const inventoryPort = createMockInventoryPort({
        variantId: undefined,
        locationId: undefined,
      });
      const productId = `ol_product_${randomUUID()}`;

      inventoryService.getInventory.mockResolvedValueOnce(null);

      const result = await (handler as any).toDomainInventoryItem(inventoryPort, productId);

      expect(result.productVariantId).toBeNull();
      expect(result.locationId).toBeNull();
    });
  });

  describe('getExternalId', () => {
    it('should extract externalId from job payload', () => {
      const job = createMockJob();
      const externalId = (handler as any).getExternalId(job);
      expect(externalId).toBe('1');
    });

    it('should throw SyncJobExecutionError when externalId is missing', () => {
      const job = createMockJob({ payload: { externalId: undefined, objectType: 'Product' } });

      expect(() => (handler as any).getExternalId(job)).toThrow(SyncJobExecutionError);
    });

    it('should throw SyncJobExecutionError when externalId is not a string', () => {
      const job = createMockJob({ payload: { externalId: 123, objectType: 'Product' } });

      expect(() => (handler as any).getExternalId(job)).toThrow(SyncJobExecutionError);
    });
  });

  describe('getObjectType', () => {
    it('should extract objectType from job payload', () => {
      const job = createMockJob();
      const objectType = (handler as any).getObjectType(job);
      expect(objectType).toBe('Product');
    });

    it('should throw SyncJobExecutionError when objectType is missing', () => {
      const job = createMockJob({ payload: { externalId: '1', objectType: undefined } });

      expect(() => (handler as any).getObjectType(job)).toThrow(SyncJobExecutionError);
    });

    it('should throw SyncJobExecutionError when objectType is not a string', () => {
      const job = createMockJob({ payload: { externalId: '1', objectType: 123 } });

      expect(() => (handler as any).getObjectType(job)).toThrow(SyncJobExecutionError);
    });
  });
});

