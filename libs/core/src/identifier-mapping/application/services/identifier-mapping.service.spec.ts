/**
 * Identifier Mapping Service Unit Tests
 *
 * Unit tests for IdentifierMappingService, verifying identifier mapping
 * operations including get-or-create semantics, Connection resolution,
 * concurrency safety, and bidirectional mapping.
 *
 * @module libs/core/src/identifier-mapping/application/services
 */
import { Test, TestingModule } from '@nestjs/testing';
import { IdentifierMappingService } from './identifier-mapping.service';
import { IdentifierMappingRepositoryPort } from '../../domain/ports/identifier-mapping-repository.port';
import { ConnectionPort } from '../../domain/ports/connection.port';
import { IdentifierMapping } from '../../domain/entities/identifier-mapping.entity';
import { Connection } from '../../domain/entities/connection.entity';
import { DuplicateIdentifierMappingError } from '../../domain/exceptions/duplicate-identifier-mapping.error';
import { MappingAlreadyExistsError } from '../../domain/exceptions/mapping-already-exists.error';
import { IDENTIFIER_MAPPING_REPOSITORY_TOKEN, CONNECTION_PORT_TOKEN } from '../../identifier-mapping.tokens';

describe('IdentifierMappingService', () => {
  let service: IdentifierMappingService;
  let repository: jest.Mocked<IdentifierMappingRepositoryPort>;
  let connectionPort: jest.Mocked<ConnectionPort>;

  beforeEach(async () => {
    const mockRepository = {
      findByExternalKey: jest.fn(),
      findByInternalId: jest.fn(),
      create: jest.fn(),
      insertMapping: jest.fn(),
      deleteByExternalKey: jest.fn(),
      findByEntityTypeAndConnection: jest.fn(),
    } as unknown as jest.Mocked<IdentifierMappingRepositoryPort>;

    const mockConnectionPort = {
      get: jest.fn(),
    } as unknown as jest.Mocked<ConnectionPort>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdentifierMappingService,
        {
          provide: IDENTIFIER_MAPPING_REPOSITORY_TOKEN,
          useValue: mockRepository,
        },
        {
          provide: CONNECTION_PORT_TOKEN,
          useValue: mockConnectionPort,
        },
      ],
    }).compile();

    service = module.get<IdentifierMappingService>(IdentifierMappingService);
    repository = module.get(IDENTIFIER_MAPPING_REPOSITORY_TOKEN);
    connectionPort = module.get(CONNECTION_PORT_TOKEN);
  });

  describe('getOrCreateInternalId', () => {
    const connectionId = 'connection-123';
    const platformType = 'prestashop';
    const connection = new Connection(
      connectionId,
      platformType,
      'Test Connection',
      'active',
      {},
      'credentials-ref',
      new Date(),
      new Date(),
        undefined,
        ['ProductMaster', 'InventoryMaster', 'OrderSource', 'OrderProcessorManager', 'OfferManager'],
    );

    beforeEach(() => {
      connectionPort.get.mockResolvedValue(connection);
    });

    it('should return existing internalId when mapping already exists (recovered via duplicate-insert path)', async () => {
      const existingMapping = new IdentifierMapping(
        'id-1',
        'Product',
        'ol_product_abc123',
        'external-123',
        platformType,
        connectionId,
        null,
        new Date(),
        new Date(),
      );

      // Pure insert-then-recover: insert attempt fails on duplicate, SELECT returns the existing row.
      const duplicateError = new DuplicateIdentifierMappingError(
        'Product',
        'external-123',
        platformType,
        connectionId,
      );
      repository.insertMapping.mockRejectedValue(duplicateError);
      repository.findByExternalKey.mockResolvedValue(existingMapping);

      const result = await service.getOrCreateInternalId(
        'Product',
        'external-123',
        connectionId,
      );

      expect(result).toBe('ol_product_abc123');
      expect(connectionPort.get).toHaveBeenCalledWith(connectionId);
      expect(repository.insertMapping).toHaveBeenCalledTimes(1);
      expect(repository.findByExternalKey).toHaveBeenCalledTimes(1);
      expect(repository.findByExternalKey).toHaveBeenCalledWith(
        'Product',
        platformType,
        connectionId,
        'external-123',
      );
    });

    it('should create new mapping if it does not exist', async () => {
      const newMapping = new IdentifierMapping(
        'id-1',
        'Product',
        'ol_product_new123',
        'external-123',
        platformType,
        connectionId,
        null,
        new Date(),
        new Date(),
      );
      repository.insertMapping.mockResolvedValue(newMapping);

      const result = await service.getOrCreateInternalId(
        'Product',
        'external-123',
        connectionId,
      );

      expect(result).toMatch(/^ol_product_/);
      expect(connectionPort.get).toHaveBeenCalledWith(connectionId);
      expect(repository.insertMapping).toHaveBeenCalled();
      // No upfront read — insert is attempted unconditionally.
      expect(repository.findByExternalKey).not.toHaveBeenCalled();
    });

    it('should return existing internalId when concurrent insert is detected', async () => {
      const winnerMapping = new IdentifierMapping(
        'id-winner',
        'Product',
        'ol_product_winner',
        'external-123',
        platformType,
        connectionId,
        null,
        new Date(),
        new Date(),
      );

      const duplicateError = new DuplicateIdentifierMappingError(
        'Product',
        'external-123',
        platformType,
        connectionId,
      );
      repository.insertMapping.mockRejectedValue(duplicateError);
      repository.findByExternalKey.mockResolvedValue(winnerMapping);

      const result = await service.getOrCreateInternalId('Product', 'external-123', connectionId);

      expect(result).toBe('ol_product_winner');
      expect(repository.insertMapping).toHaveBeenCalledTimes(1);
      expect(repository.findByExternalKey).toHaveBeenCalledTimes(1);
    });

    it('should re-throw DuplicateIdentifierMappingError when winner cannot be found after concurrent insert', async () => {
      // Insert fails with duplicate AND the winner row has vanished (delete-during-race window)
      repository.findByExternalKey.mockResolvedValue(null);

      const duplicateError = new DuplicateIdentifierMappingError(
        'Product',
        'external-123',
        platformType,
        connectionId,
      );
      repository.insertMapping.mockRejectedValue(duplicateError);

      await expect(
        service.getOrCreateInternalId('Product', 'external-123', connectionId),
      ).rejects.toThrow(DuplicateIdentifierMappingError);

      expect(repository.findByExternalKey).toHaveBeenCalledTimes(1);
    });

    it('should resolve platformType from Connection', async () => {
      repository.insertMapping.mockResolvedValue(
        new IdentifierMapping(
          'id-1',
          'Product',
          'ol_product_new123',
          'external-123',
          platformType,
          connectionId,
          null,
          new Date(),
          new Date(),
        ),
      );

      await service.getOrCreateInternalId('Product', 'external-123', connectionId);

      expect(connectionPort.get).toHaveBeenCalledWith(connectionId);
      // platformType propagates into the mapping passed to insertMapping
      expect(repository.insertMapping).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'Product',
          externalId: 'external-123',
          platformType,
          connectionId,
        }),
      );
    });

    it('should converge on a single internalId when N concurrent callers race', async () => {
      // Drives N parallel getOrCreateInternalId calls against a simulated DB.
      // Only the first insertMapping succeeds; the rest throw DuplicateIdentifierMappingError.
      // findByExternalKey always returns the saved row (the "winner") after that.
      const N = 10;
      let savedMapping: IdentifierMapping | null = null;

      repository.insertMapping.mockImplementation((mapping) => {
        if (!savedMapping) {
          savedMapping = mapping;
          return Promise.resolve(mapping);
        }
        return Promise.reject(
          new DuplicateIdentifierMappingError(
            mapping.entityType,
            mapping.externalId,
            mapping.platformType,
            mapping.connectionId,
          ),
        );
      });
      repository.findByExternalKey.mockImplementation(() => Promise.resolve(savedMapping));

      const results = await Promise.all(
        Array.from({ length: N }, () =>
          service.getOrCreateInternalId('Product', 'external-race', connectionId),
        ),
      );

      expect(new Set(results).size).toBe(1);
      expect(results[0]).toMatch(/^ol_product_[a-f0-9]{32}$/);
      expect(repository.insertMapping).toHaveBeenCalledTimes(N);
      // N - 1 duplicate-recoveries each do one SELECT; the winner does zero.
      expect(repository.findByExternalKey).toHaveBeenCalledTimes(N - 1);
    });

    describe('internal ID prefix', () => {
      beforeEach(() => {
        repository.insertMapping.mockImplementation((mapping) => Promise.resolve(mapping));
      });

      it('should mint ol_product_* IDs for Product (default lowercase prefix)', async () => {
        const result = await service.getOrCreateInternalId('Product', 'ext', connectionId);
        expect(result).toMatch(/^ol_product_[a-f0-9]{32}$/);
      });

      it('should mint ol_variant_* IDs for ProductVariant (explicit override)', async () => {
        const result = await service.getOrCreateInternalId('ProductVariant', 'ext', connectionId);
        expect(result).toMatch(/^ol_variant_[a-f0-9]{32}$/);
        expect(result).not.toMatch(/^ol_productvariant_/);
      });

      it('should mint ol_order_* IDs for Order (default lowercase prefix, sanity baseline)', async () => {
        const result = await service.getOrCreateInternalId('Order', 'ext', connectionId);
        expect(result).toMatch(/^ol_order_[a-f0-9]{32}$/);
      });
    });
  });

  describe('getInternalId', () => {
    const connectionId = 'connection-123';
    const platformType = 'prestashop';
    const connection = new Connection(
      connectionId,
      platformType,
      'Test Connection',
      'active',
      {},
      'credentials-ref',
      new Date(),
      new Date(),
        undefined,
        ['ProductMaster', 'InventoryMaster', 'OrderSource', 'OrderProcessorManager', 'OfferManager'],
    );

    beforeEach(() => {
      connectionPort.get.mockResolvedValue(connection);
    });

    it('should return internal ID if mapping exists', async () => {
      const mapping = new IdentifierMapping(
        'id-1',
        'Product',
        'ol_product_abc123',
        'external-123',
        platformType,
        connectionId,
        null,
        new Date(),
        new Date(),
      );

      repository.findByExternalKey.mockResolvedValue(mapping);

      const result = await service.getInternalId('Product', 'external-123', connectionId);

      expect(result).toBe('ol_product_abc123');
      expect(connectionPort.get).toHaveBeenCalledWith(connectionId);
    });

    it('should return null if mapping does not exist', async () => {
      repository.findByExternalKey.mockResolvedValue(null);

      const result = await service.getInternalId('Product', 'external-123', connectionId);

      expect(result).toBeNull();
    });
  });

  describe('getExternalIds', () => {
    it('should return all external IDs mapped to internal ID', async () => {
      const mappings = [
        new IdentifierMapping(
          'id-1',
          'Product',
          'ol_product_abc123',
          'external-1',
          'prestashop',
          'connection-1',
          null,
          new Date(),
          new Date(),
        ),
        new IdentifierMapping(
          'id-2',
          'Product',
          'ol_product_abc123',
          'external-2',
          'allegro',
          'connection-2',
          null,
          new Date(),
          new Date(),
        ),
      ];

      repository.findByInternalId.mockResolvedValue(mappings);

      const result = await service.getExternalIds('Product', 'ol_product_abc123');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        externalId: 'external-1',
        platformType: 'prestashop',
        connectionId: 'connection-1',
        entityType: 'Product',
      });
      expect(result[1]).toEqual({
        externalId: 'external-2',
        platformType: 'allegro',
        connectionId: 'connection-2',
        entityType: 'Product',
      });
    });
  });

  describe('createMapping', () => {
    const connectionId = 'connection-123';
    const platformType = 'prestashop';
    const connection = new Connection(
      connectionId,
      platformType,
      'Test Connection',
      'active',
      {},
      'credentials-ref',
      new Date(),
      new Date(),
        undefined,
        ['ProductMaster', 'InventoryMaster', 'OrderSource', 'OrderProcessorManager', 'OfferManager'],
    );

    beforeEach(() => {
      connectionPort.get.mockResolvedValue(connection);
    });

    it('should create mapping when it does not exist', async () => {
      const newMapping = new IdentifierMapping(
        'id-1',
        'Product',
        'ol_product_abc123',
        'external-123',
        platformType,
        connectionId,
        null,
        new Date(),
        new Date(),
      );
      repository.insertMapping.mockResolvedValue(newMapping);

      await service.createMapping(
        'Product',
        'external-123',
        connectionId,
        'ol_product_abc123',
      );

      expect(connectionPort.get).toHaveBeenCalledWith(connectionId);
      expect(repository.insertMapping).toHaveBeenCalled();
      // No upfront read — insert is attempted unconditionally.
      expect(repository.findByExternalKey).not.toHaveBeenCalled();
    });

    it('should throw MappingAlreadyExistsError if mapping already exists (recovered via duplicate-insert path)', async () => {
      const existingMapping = new IdentifierMapping(
        'id-1',
        'Product',
        'ol_product_existing',
        'external-123',
        platformType,
        connectionId,
        null,
        new Date(),
        new Date(),
      );
      const duplicateError = new DuplicateIdentifierMappingError(
        'Product',
        'external-123',
        platformType,
        connectionId,
      );
      repository.insertMapping.mockRejectedValue(duplicateError);
      repository.findByExternalKey.mockResolvedValue(existingMapping);

      await expect(
        service.createMapping('Product', 'external-123', connectionId, 'ol_product_new'),
      ).rejects.toThrow(MappingAlreadyExistsError);

      expect(repository.findByExternalKey).toHaveBeenCalledWith(
        'Product',
        platformType,
        connectionId,
        'external-123',
      );
    });

    it('should re-throw DuplicateIdentifierMappingError when winner cannot be found after concurrent insert', async () => {
      const duplicateError = new DuplicateIdentifierMappingError(
        'Product',
        'external-123',
        platformType,
        connectionId,
      );
      repository.insertMapping.mockRejectedValue(duplicateError);
      repository.findByExternalKey.mockResolvedValue(null);

      await expect(
        service.createMapping('Product', 'external-123', connectionId, 'ol_product_new'),
      ).rejects.toThrow(DuplicateIdentifierMappingError);
    });
  });

  describe('batchGetOrCreateInternalIds', () => {
    it('should batch process multiple requests and return composite key map', async () => {
      const connection1 = new Connection(
        'connection-1',
        'prestashop',
        'Connection 1',
        'active',
        {},
        'credentials-ref',
        new Date(),
        new Date(),
        undefined,
        ['ProductMaster', 'InventoryMaster', 'OrderSource', 'OrderProcessorManager', 'OfferManager'],
      );
      const connection2 = new Connection(
        'connection-2',
        'allegro',
        'Connection 2',
        'active',
        {},
        'credentials-ref',
        new Date(),
        new Date(),
        undefined,
        ['ProductMaster', 'InventoryMaster', 'OrderSource', 'OrderProcessorManager', 'OfferManager'],
      );

      // batchGetOrCreateInternalIds deduplicates connectionIds and calls get() once per unique ID
      connectionPort.get
        .mockResolvedValueOnce(connection1)
        .mockResolvedValueOnce(connection2);

      repository.findByExternalKey.mockResolvedValue(null);
      repository.insertMapping
        .mockResolvedValueOnce(
          new IdentifierMapping(
            'id-1',
            'Product',
            'ol_product_1',
            'external-1',
            'prestashop',
            'connection-1',
            null,
            new Date(),
            new Date(),
          ),
        )
        .mockResolvedValueOnce(
          new IdentifierMapping(
            'id-2',
            'Product',
            'ol_product_2',
            'external-2',
            'allegro',
            'connection-2',
            null,
            new Date(),
            new Date(),
          ),
        );

      const requests = [
        {
          entityType: 'Product' as const,
          externalId: 'external-1',
          connectionId: 'connection-1',
        },
        {
          entityType: 'Product' as const,
          externalId: 'external-2',
          connectionId: 'connection-2',
        },
      ];

      const result = await service.batchGetOrCreateInternalIds(requests);

      expect(result.size).toBe(2);
      // Verify that internal IDs are generated and match the expected pattern
      const id1 = result.get('external-1:connection-1');
      const id2 = result.get('external-2:connection-2');
      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(id1).toMatch(/^ol_product_[a-f0-9]{32}$/);
      expect(id2).toMatch(/^ol_product_[a-f0-9]{32}$/);
      expect(id1).not.toBe(id2); // Ensure they are different
    });
  });

  describe('listExternalIdsByConnection', () => {
    it('should return external IDs from repository mappings', async () => {
      const mappings = [
        new IdentifierMapping('m1', 'Product', 'ol_product_abc', 'ext-1', 'prestashop', 'conn-1', null, new Date(), new Date()),
        new IdentifierMapping('m2', 'Product', 'ol_product_def', 'ext-2', 'prestashop', 'conn-1', null, new Date(), new Date()),
      ];
      repository.findByEntityTypeAndConnection.mockResolvedValue(mappings);

      const result = await service.listExternalIdsByConnection('Product', 'conn-1');

      expect(repository.findByEntityTypeAndConnection).toHaveBeenCalledWith('Product', 'conn-1');
      expect(result).toEqual(['ext-1', 'ext-2']);
    });

    it('should return empty array when no mappings found', async () => {
      repository.findByEntityTypeAndConnection.mockResolvedValue([]);

      const result = await service.listExternalIdsByConnection('Product', 'conn-1');

      expect(result).toEqual([]);
    });
  });
});
