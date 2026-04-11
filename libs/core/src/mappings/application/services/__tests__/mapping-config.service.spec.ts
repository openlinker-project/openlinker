/**
 * MappingConfigService unit tests
 *
 * @module libs/core/src/mappings/application/services/__tests__
 */

import { Test, TestingModule } from '@nestjs/testing';
import { MappingConfigService } from '../mapping-config.service';
import {
  STATUS_MAPPING_REPOSITORY_TOKEN,
  CARRIER_MAPPING_REPOSITORY_TOKEN,
  PAYMENT_MAPPING_REPOSITORY_TOKEN,
  CATEGORY_MAPPING_REPOSITORY_TOKEN,
} from '../../../mappings.tokens';
import { StatusMappingRepositoryPort } from '../../../domain/ports/status-mapping-repository.port';
import { CarrierMappingRepositoryPort } from '../../../domain/ports/carrier-mapping-repository.port';
import { PaymentMappingRepositoryPort } from '../../../domain/ports/payment-mapping-repository.port';
import { CategoryMappingRepositoryPort } from '../../../domain/ports/category-mapping-repository.port';
import { StatusMapping } from '../../../domain/entities/status-mapping.entity';
import { CarrierMapping } from '../../../domain/entities/carrier-mapping.entity';
import { PaymentMapping } from '../../../domain/entities/payment-mapping.entity';
import { CategoryMapping } from '../../../domain/entities/category-mapping.entity';

describe('MappingConfigService', () => {
  let service: MappingConfigService;
  let statusRepo: jest.Mocked<StatusMappingRepositoryPort>;
  let carrierRepo: jest.Mocked<CarrierMappingRepositoryPort>;
  let paymentRepo: jest.Mocked<PaymentMappingRepositoryPort>;
  let categoryRepo: jest.Mocked<CategoryMappingRepositoryPort>;

  const CONNECTION_ID = 'conn-uuid-1';

  beforeEach(async () => {
    statusRepo = {
      findByConnectionId: jest.fn(),
      replaceForConnection: jest.fn(),
    };
    carrierRepo = {
      findByConnectionId: jest.fn(),
      replaceForConnection: jest.fn(),
    };
    paymentRepo = {
      findByConnectionId: jest.fn(),
      replaceForConnection: jest.fn(),
    };
    categoryRepo = {
      findByConnectionId: jest.fn(),
      findByPrestashopCategoryId: jest.fn(),
      upsertMapping: jest.fn(),
      deleteMapping: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MappingConfigService,
        { provide: STATUS_MAPPING_REPOSITORY_TOKEN, useValue: statusRepo },
        { provide: CARRIER_MAPPING_REPOSITORY_TOKEN, useValue: carrierRepo },
        { provide: PAYMENT_MAPPING_REPOSITORY_TOKEN, useValue: paymentRepo },
        { provide: CATEGORY_MAPPING_REPOSITORY_TOKEN, useValue: categoryRepo },
      ],
    }).compile();

    service = module.get(MappingConfigService);
  });

  // ── Status mappings ────────────────────────────────────────────────────

  describe('getStatusMappings', () => {
    it('should return mappings from repository', async () => {
      const mappings = [
        new StatusMapping('id-1', CONNECTION_ID, 'READY_FOR_PROCESSING', '2'),
      ];
      statusRepo.findByConnectionId.mockResolvedValue(mappings);

      const result = await service.getStatusMappings(CONNECTION_ID);

      expect(statusRepo.findByConnectionId).toHaveBeenCalledWith(CONNECTION_ID);
      expect(result).toEqual(mappings);
    });
  });

  describe('upsertStatusMappings', () => {
    it('should delegate to replaceForConnection and return saved mappings', async () => {
      const input = [{ allegroStatus: 'BOUGHT', prestashopStatusId: '1' }];
      const saved = [new StatusMapping('id-2', CONNECTION_ID, 'BOUGHT', '1')];
      statusRepo.replaceForConnection.mockResolvedValue(saved);

      const result = await service.upsertStatusMappings(CONNECTION_ID, input);

      expect(statusRepo.replaceForConnection).toHaveBeenCalledWith(CONNECTION_ID, input);
      expect(result).toEqual(saved);
    });
  });

  // ── resolveStatusMapping ───────────────────────────────────────────────

  describe('resolveStatusMapping', () => {
    it('should return prestashopStatusId when allegroStatus matches', async () => {
      statusRepo.findByConnectionId.mockResolvedValue([
        new StatusMapping('id-1', CONNECTION_ID, 'READY_FOR_PROCESSING', '2'),
        new StatusMapping('id-2', CONNECTION_ID, 'CANCELLED', '6'),
      ]);

      const result = await service.resolveStatusMapping(CONNECTION_ID, 'READY_FOR_PROCESSING');

      expect(result).toBe('2');
    });

    it('should return null when no mapping matches the given allegroStatus', async () => {
      statusRepo.findByConnectionId.mockResolvedValue([
        new StatusMapping('id-1', CONNECTION_ID, 'READY_FOR_PROCESSING', '2'),
      ]);

      const result = await service.resolveStatusMapping(CONNECTION_ID, 'UNKNOWN_STATUS');

      expect(result).toBeNull();
    });

    it('should return null when connection has no mappings configured', async () => {
      statusRepo.findByConnectionId.mockResolvedValue([]);

      const result = await service.resolveStatusMapping(CONNECTION_ID, 'READY_FOR_PROCESSING');

      expect(result).toBeNull();
    });
  });

  // ── Carrier mappings ───────────────────────────────────────────────────

  describe('getCarrierMappings', () => {
    it('should return carrier mappings from repository', async () => {
      const mappings = [
        new CarrierMapping('id-1', CONNECTION_ID, 'INPOST_PACZKOMAT', '2'),
      ];
      carrierRepo.findByConnectionId.mockResolvedValue(mappings);

      const result = await service.getCarrierMappings(CONNECTION_ID);

      expect(result).toEqual(mappings);
    });
  });

  describe('upsertCarrierMappings', () => {
    it('should delegate to replaceForConnection', async () => {
      const input = [{ allegroDeliveryMethodId: 'DPD', prestashopCarrierId: '3' }];
      const saved = [new CarrierMapping('id-3', CONNECTION_ID, 'DPD', '3')];
      carrierRepo.replaceForConnection.mockResolvedValue(saved);

      const result = await service.upsertCarrierMappings(CONNECTION_ID, input);

      expect(carrierRepo.replaceForConnection).toHaveBeenCalledWith(CONNECTION_ID, input);
      expect(result).toEqual(saved);
    });
  });

  // ── Payment mappings ───────────────────────────────────────────────────

  describe('getPaymentMappings', () => {
    it('should return payment mappings from repository', async () => {
      const mappings = [
        new PaymentMapping('id-1', CONNECTION_ID, 'P24', 'przelewy24'),
      ];
      paymentRepo.findByConnectionId.mockResolvedValue(mappings);

      const result = await service.getPaymentMappings(CONNECTION_ID);

      expect(result).toEqual(mappings);
    });
  });

  describe('upsertPaymentMappings', () => {
    it('should delegate to replaceForConnection', async () => {
      const input = [{ allegroPaymentProvider: 'BLIK', prestashopPaymentModule: 'payu' }];
      const saved = [new PaymentMapping('id-4', CONNECTION_ID, 'BLIK', 'payu')];
      paymentRepo.replaceForConnection.mockResolvedValue(saved);

      const result = await service.upsertPaymentMappings(CONNECTION_ID, input);

      expect(paymentRepo.replaceForConnection).toHaveBeenCalledWith(CONNECTION_ID, input);
      expect(result).toEqual(saved);
    });
  });

  // ── Category mappings ─────────────────────────────────────────────────

  describe('getCategoryMappings', () => {
    it('should return category mappings from repository', async () => {
      const mappings = [
        new CategoryMapping('id-1', CONNECTION_ID, '3', '258066', 'Smartphones', 'Electronics > Phones > Smartphones'),
      ];
      categoryRepo.findByConnectionId.mockResolvedValue(mappings);

      const result = await service.getCategoryMappings(CONNECTION_ID);

      expect(categoryRepo.findByConnectionId).toHaveBeenCalledWith(CONNECTION_ID);
      expect(result).toEqual(mappings);
    });
  });

  describe('upsertCategoryMapping', () => {
    it('should delegate to repository upsertMapping', async () => {
      const input = {
        prestashopCategoryId: '5',
        allegroCategoryId: '258066',
        allegroCategoryName: 'Smartphones',
        allegroCategoryPath: 'Electronics > Phones > Smartphones',
      };
      const saved = new CategoryMapping('id-5', CONNECTION_ID, '5', '258066', 'Smartphones', 'Electronics > Phones > Smartphones');
      categoryRepo.upsertMapping.mockResolvedValue(saved);

      const result = await service.upsertCategoryMapping(CONNECTION_ID, input);

      expect(categoryRepo.upsertMapping).toHaveBeenCalledWith(CONNECTION_ID, input);
      expect(result).toEqual(saved);
    });
  });

  describe('deleteCategoryMapping', () => {
    it('should delegate to repository deleteMapping', async () => {
      categoryRepo.deleteMapping.mockResolvedValue(undefined);

      await service.deleteCategoryMapping(CONNECTION_ID, '5');

      expect(categoryRepo.deleteMapping).toHaveBeenCalledWith(CONNECTION_ID, '5');
    });
  });

  describe('resolveAllegroCategory', () => {
    it('should return allegroCategoryId when mapping exists', async () => {
      const mapping = new CategoryMapping('id-1', CONNECTION_ID, '3', '258066', 'Smartphones', null);
      categoryRepo.findByPrestashopCategoryId.mockResolvedValue(mapping);

      const result = await service.resolveAllegroCategory(CONNECTION_ID, '3');

      expect(result).toBe('258066');
    });

    it('should return null when no mapping exists', async () => {
      categoryRepo.findByPrestashopCategoryId.mockResolvedValue(null);

      const result = await service.resolveAllegroCategory(CONNECTION_ID, '999');

      expect(result).toBeNull();
    });
  });
});
