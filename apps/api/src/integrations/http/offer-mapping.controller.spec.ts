/**
 * Offer Mapping Controller Unit Tests
 *
 * Unit tests for OfferMappingController, verifying HTTP endpoint handling,
 * CRUD operations, validation, and error handling.
 *
 * @module apps/api/src/integrations/http
 */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OfferMappingController } from './offer-mapping.controller';
import { IOfferMappingService, OFFER_MAPPING_SERVICE_TOKEN, OfferMapping } from '@openlinker/core/listings';
import { DuplicateOfferMappingError } from '@openlinker/core/listings';
import { randomUUID } from 'crypto';

describe('OfferMappingController', () => {
  let controller: OfferMappingController;
  let service: jest.Mocked<IOfferMappingService>;

  const createMockMapping = (overrides: Partial<OfferMapping> = {}): OfferMapping => {
    const now = new Date();
    return new OfferMapping(
      overrides.id || randomUUID(),
      overrides.connectionId || randomUUID(),
      overrides.platformType || 'allegro',
      overrides.offerId || 'offer-123',
      overrides.internalProductId || 'product-456',
      overrides.variantId ?? null,
      overrides.createdAt || now,
      overrides.updatedAt || now,
    );
  };

  beforeEach(async () => {
    const mockService = {
      create: jest.fn(),
      findById: jest.fn(),
      findByConnectionAndOffer: jest.fn(),
      findByProduct: jest.fn(),
      findByConnection: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<IOfferMappingService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OfferMappingController],
      providers: [
        {
          provide: OFFER_MAPPING_SERVICE_TOKEN,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<OfferMappingController>(OfferMappingController);
    service = module.get(OFFER_MAPPING_SERVICE_TOKEN);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create offer mapping successfully', async () => {
      const dto = {
        connectionId: randomUUID(),
        platformType: 'allegro',
        offerId: 'offer-123',
        internalProductId: 'product-456',
        variantId: 'variant-789',
      };

      const mapping = createMockMapping(dto);
      service.create.mockResolvedValue(mapping);

      const result = await controller.create(dto);

      expect(result.id).toBe(mapping.id);
      expect(result.connectionId).toBe(dto.connectionId);
      expect(result.offerId).toBe(dto.offerId);
      expect(result.internalProductId).toBe(dto.internalProductId);
      expect(result.variantId).toBe(dto.variantId);
      expect(service.create).toHaveBeenCalledWith(
        dto.connectionId,
        dto.platformType,
        dto.offerId,
        dto.internalProductId,
        dto.variantId,
      );
    });

    it('should create offer mapping without variant', async () => {
      const dto = {
        connectionId: randomUUID(),
        platformType: 'allegro',
        offerId: 'offer-123',
        internalProductId: 'product-456',
      };

      const mapping = createMockMapping({ ...dto, variantId: null });
      service.create.mockResolvedValue(mapping);

      const result = await controller.create(dto);

      expect(result.variantId).toBeNull();
      expect(service.create).toHaveBeenCalledWith(
        dto.connectionId,
        dto.platformType,
        dto.offerId,
        dto.internalProductId,
        undefined,
      );
    });

    it('should throw BadRequestException on duplicate mapping', async () => {
      const dto = {
        connectionId: randomUUID(),
        platformType: 'allegro',
        offerId: 'offer-123',
        internalProductId: 'product-456',
      };

      const duplicateError = new DuplicateOfferMappingError(dto.connectionId, dto.offerId);
      service.create.mockRejectedValue(duplicateError);

      await expect(controller.create(dto)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when error message includes "already exists"', async () => {
      const dto = {
        connectionId: randomUUID(),
        platformType: 'allegro',
        offerId: 'offer-123',
        internalProductId: 'product-456',
      };

      const error = new Error('Mapping already exists');
      service.create.mockRejectedValue(error);

      await expect(controller.create(dto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('list', () => {
    it('should return mappings filtered by connectionId', async () => {
      const connectionId = randomUUID();
      const mappings = [
        createMockMapping({ connectionId, offerId: 'offer-1' }),
        createMockMapping({ connectionId, offerId: 'offer-2' }),
      ];

      service.findByConnection.mockResolvedValue(mappings);

      const result = await controller.list(connectionId, undefined);

      expect(result).toHaveLength(2);
      expect(result[0].connectionId).toBe(connectionId);
      expect(service.findByConnection).toHaveBeenCalledWith(connectionId);
    });

    it('should return mappings filtered by productId', async () => {
      const productId = 'product-456';
      const mappings = [
        createMockMapping({ internalProductId: productId, offerId: 'offer-1' }),
        createMockMapping({ internalProductId: productId, offerId: 'offer-2' }),
      ];

      service.findByProduct.mockResolvedValue(mappings);

      const result = await controller.list(undefined, productId);

      expect(result).toHaveLength(2);
      expect(result[0].internalProductId).toBe(productId);
      expect(service.findByProduct).toHaveBeenCalledWith(productId);
    });

    it('should throw BadRequestException when no filters provided', async () => {
      await expect(controller.list(undefined, undefined)).rejects.toThrow(BadRequestException);
      await expect(controller.list(undefined, undefined)).rejects.toThrow('At least one filter');
    });
  });

  describe('get', () => {
    it('should return mapping by ID', async () => {
      const mappingId = randomUUID();
      const mapping = createMockMapping({ id: mappingId });

      service.findById.mockResolvedValue(mapping);

      const result = await controller.get(mappingId);

      expect(result.id).toBe(mappingId);
      expect(result.connectionId).toBe(mapping.connectionId);
      expect(service.findById).toHaveBeenCalledWith(mappingId);
    });

    it('should throw NotFoundException when mapping not found', async () => {
      const mappingId = randomUUID();
      service.findById.mockResolvedValue(null);

      await expect(controller.get(mappingId)).rejects.toThrow(NotFoundException);
      await expect(controller.get(mappingId)).rejects.toThrow('Offer mapping not found');
    });
  });

  describe('update', () => {
    it('should update mapping successfully', async () => {
      const mappingId = randomUUID();
      const dto = {
        internalProductId: 'new-product-789',
        variantId: 'new-variant-999',
      };

      const updatedMapping = createMockMapping({
        id: mappingId,
        internalProductId: dto.internalProductId,
        variantId: dto.variantId,
      });

      service.update.mockResolvedValue(updatedMapping);

      const result = await controller.update(mappingId, dto);

      expect(result.id).toBe(mappingId);
      expect(result.internalProductId).toBe(dto.internalProductId);
      expect(result.variantId).toBe(dto.variantId);
      expect(service.update).toHaveBeenCalledWith(mappingId, {
        internalProductId: dto.internalProductId,
        variantId: dto.variantId,
      });
    });

    it('should update mapping with null variant', async () => {
      const mappingId = randomUUID();
      const dto = {
        internalProductId: 'new-product-789',
        variantId: null,
      };

      const updatedMapping = createMockMapping({
        id: mappingId,
        internalProductId: dto.internalProductId,
        variantId: null,
      });

      service.update.mockResolvedValue(updatedMapping);

      const result = await controller.update(mappingId, dto);

      expect(result.variantId).toBeNull();
      expect(service.update).toHaveBeenCalledWith(mappingId, {
        internalProductId: dto.internalProductId,
        variantId: null,
      });
    });

    it('should throw NotFoundException when mapping not found', async () => {
      const mappingId = randomUUID();
      const dto = {
        internalProductId: 'new-product-789',
      };

      const error = new Error('Mapping not found');
      service.update.mockRejectedValue(error);

      await expect(controller.update(mappingId, dto)).rejects.toThrow(NotFoundException);
    });
  });

  describe('delete', () => {
    it('should delete mapping successfully', async () => {
      const mappingId = randomUUID();
      service.delete.mockResolvedValue(undefined);

      await controller.delete(mappingId);

      expect(service.delete).toHaveBeenCalledWith(mappingId);
    });

    it('should throw NotFoundException when mapping not found', async () => {
      const mappingId = randomUUID();
      const error = new Error('Mapping not found');
      service.delete.mockRejectedValue(error);

      await expect(controller.delete(mappingId)).rejects.toThrow(NotFoundException);
    });
  });
});



