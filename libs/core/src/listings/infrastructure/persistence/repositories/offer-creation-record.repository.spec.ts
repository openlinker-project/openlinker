/**
 * Offer Creation Record Repository — Unit Tests
 *
 * Verifies CRUD operations, domain mapping, and not-found exception handling.
 *
 * @module libs/core/src/listings/infrastructure/persistence/repositories
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { OfferCreationRecordRepository } from './offer-creation-record.repository';
import { OfferCreationRecordOrmEntity } from '../entities/offer-creation-record.orm-entity';
import { OfferCreationRecord } from '../../../domain/entities/offer-creation-record.entity';
import { OfferCreationRecordNotFoundException } from '../../../domain/exceptions/offer-creation-record-not-found.exception';
import type {
  CreateOfferCreationRecordInput,
  OfferCreationError,
} from '../../../domain/types/offer-creation-record.types';

describe('OfferCreationRecordRepository', () => {
  let repository: OfferCreationRecordRepository;
  let ormRepository: jest.Mocked<Repository<OfferCreationRecordOrmEntity>>;

  const now = new Date('2026-04-20T10:00:00Z');

  const buildOrm = (
    overrides: Partial<OfferCreationRecordOrmEntity> = {},
  ): OfferCreationRecordOrmEntity => ({
    id: 'rec-uuid',
    internalVariantId: 'ol_variant_123',
    connectionId: 'conn-uuid',
    externalOfferId: null,
    status: 'pending',
    errors: null,
    publishImmediately: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });

  beforeEach(async () => {
    const mockOrmRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
    } as unknown as jest.Mocked<Repository<OfferCreationRecordOrmEntity>>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OfferCreationRecordRepository,
        {
          provide: getRepositoryToken(OfferCreationRecordOrmEntity),
          useValue: mockOrmRepo,
        },
      ],
    }).compile();

    repository = module.get<OfferCreationRecordRepository>(OfferCreationRecordRepository);
    ormRepository = module.get(getRepositoryToken(OfferCreationRecordOrmEntity));
  });

  describe('create', () => {
    it('should persist a new record and return a domain entity', async () => {
      const input: CreateOfferCreationRecordInput = {
        internalVariantId: 'ol_variant_123',
        connectionId: 'conn-uuid',
        status: 'pending',
        publishImmediately: true,
      };
      const saved = buildOrm({ publishImmediately: true });
      ormRepository.save.mockResolvedValue(saved);

      const result = await repository.create(input);

      expect(ormRepository.save).toHaveBeenCalledTimes(1);
      const savedArg = ormRepository.save.mock.calls[0][0] as OfferCreationRecordOrmEntity;
      expect(savedArg.internalVariantId).toBe('ol_variant_123');
      expect(savedArg.connectionId).toBe('conn-uuid');
      expect(savedArg.status).toBe('pending');
      expect(savedArg.publishImmediately).toBe(true);
      expect(savedArg.externalOfferId).toBeNull();
      expect(savedArg.errors).toBeNull();

      expect(result).toBeInstanceOf(OfferCreationRecord);
      expect(result.id).toBe('rec-uuid');
      expect(result.publishImmediately).toBe(true);
    });

    it('should accept optional externalOfferId and errors on create', async () => {
      const errors: OfferCreationError[] = [
        { field: 'parameters.EAN', code: 'MISSING', message: 'EAN is required' },
      ];
      const input: CreateOfferCreationRecordInput = {
        internalVariantId: 'ol_variant_123',
        connectionId: 'conn-uuid',
        status: 'failed',
        publishImmediately: false,
        externalOfferId: 'allegro-1',
        errors,
      };
      ormRepository.save.mockResolvedValue(
        buildOrm({ externalOfferId: 'allegro-1', status: 'failed', errors }),
      );

      const result = await repository.create(input);

      const savedArg = ormRepository.save.mock.calls[0][0] as OfferCreationRecordOrmEntity;
      expect(savedArg.externalOfferId).toBe('allegro-1');
      expect(savedArg.errors).toEqual(errors);
      expect(result.status).toBe('failed');
      expect(result.externalOfferId).toBe('allegro-1');
    });
  });

  describe('findById', () => {
    it('should return domain entity when found', async () => {
      ormRepository.findOne.mockResolvedValue(buildOrm());

      const result = await repository.findById('rec-uuid');

      expect(ormRepository.findOne).toHaveBeenCalledWith({ where: { id: 'rec-uuid' } });
      expect(result).toBeInstanceOf(OfferCreationRecord);
      expect(result?.id).toBe('rec-uuid');
    });

    it('should return null when not found', async () => {
      ormRepository.findOne.mockResolvedValue(null);

      const result = await repository.findById('missing');

      expect(result).toBeNull();
    });
  });

  describe('findLatestByVariantAndConnection', () => {
    it('should order by createdAt DESC and scope to the pair', async () => {
      ormRepository.findOne.mockResolvedValue(buildOrm());

      const result = await repository.findLatestByVariantAndConnection('ol_variant_123', 'conn-uuid');

      expect(ormRepository.findOne).toHaveBeenCalledWith({
        where: { internalVariantId: 'ol_variant_123', connectionId: 'conn-uuid' },
        order: { createdAt: 'DESC' },
      });
      expect(result).toBeInstanceOf(OfferCreationRecord);
    });

    it('should return null when no record exists for the pair', async () => {
      ormRepository.findOne.mockResolvedValue(null);

      const result = await repository.findLatestByVariantAndConnection('v', 'c');

      expect(result).toBeNull();
    });
  });

  describe('updateStatus', () => {
    it('should update status and errors and return the updated domain entity', async () => {
      const existing = buildOrm();
      ormRepository.findOne.mockResolvedValue(existing);
      const errors: OfferCreationError[] = [
        { code: 'VALIDATION_TIMEOUT', message: 'Platform did not respond within window' },
      ];
      const saved = buildOrm({ status: 'failed', errors });
      ormRepository.save.mockResolvedValue(saved);

      const result = await repository.updateStatus('rec-uuid', 'failed', errors);

      expect(ormRepository.findOne).toHaveBeenCalledWith({ where: { id: 'rec-uuid' } });
      const savedArg = ormRepository.save.mock.calls[0][0] as OfferCreationRecordOrmEntity;
      expect(savedArg.status).toBe('failed');
      expect(savedArg.errors).toEqual(errors);
      expect(result.status).toBe('failed');
      expect(result.errors).toEqual(errors);
    });

    it('should preserve existing errors when errors argument is omitted', async () => {
      const existing = buildOrm({ errors: [{ code: 'OLD', message: 'old error' }] });
      ormRepository.findOne.mockResolvedValue(existing);
      ormRepository.save.mockResolvedValue({ ...existing, status: 'active' });

      await repository.updateStatus('rec-uuid', 'active');

      const savedArg = ormRepository.save.mock.calls[0][0] as OfferCreationRecordOrmEntity;
      expect(savedArg.status).toBe('active');
      expect(savedArg.errors).toEqual([{ code: 'OLD', message: 'old error' }]);
    });

    it('should throw OfferCreationRecordNotFoundException when record is missing', async () => {
      ormRepository.findOne.mockResolvedValue(null);

      await expect(repository.updateStatus('missing', 'active')).rejects.toBeInstanceOf(
        OfferCreationRecordNotFoundException,
      );
      expect(ormRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('updateExternalOfferId', () => {
    it('should assign externalOfferId and return the updated entity', async () => {
      const existing = buildOrm();
      ormRepository.findOne.mockResolvedValue(existing);
      const saved = buildOrm({ externalOfferId: 'allegro-offer-9999' });
      ormRepository.save.mockResolvedValue(saved);

      const result = await repository.updateExternalOfferId('rec-uuid', 'allegro-offer-9999');

      const savedArg = ormRepository.save.mock.calls[0][0] as OfferCreationRecordOrmEntity;
      expect(savedArg.externalOfferId).toBe('allegro-offer-9999');
      expect(result.externalOfferId).toBe('allegro-offer-9999');
    });

    it('should throw OfferCreationRecordNotFoundException when record is missing', async () => {
      ormRepository.findOne.mockResolvedValue(null);

      await expect(repository.updateExternalOfferId('missing', 'x')).rejects.toBeInstanceOf(
        OfferCreationRecordNotFoundException,
      );
      expect(ormRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('updateExternalIdAndStatus', () => {
    it('should atomically set externalOfferId, status and errors in one save', async () => {
      const existing = buildOrm();
      ormRepository.findOne.mockResolvedValue(existing);
      const errors: OfferCreationError[] = [
        { field: 'parameters.EAN', code: 'MISSING', message: 'EAN is required' },
      ];
      const saved = buildOrm({
        externalOfferId: 'allegro-offer-42',
        status: 'draft',
        errors,
      });
      ormRepository.save.mockResolvedValue(saved);

      const result = await repository.updateExternalIdAndStatus(
        'rec-uuid',
        'allegro-offer-42',
        'draft',
        errors,
      );

      expect(ormRepository.save).toHaveBeenCalledTimes(1);
      const savedArg = ormRepository.save.mock.calls[0][0] as OfferCreationRecordOrmEntity;
      expect(savedArg.externalOfferId).toBe('allegro-offer-42');
      expect(savedArg.status).toBe('draft');
      expect(savedArg.errors).toEqual(errors);
      expect(result.externalOfferId).toBe('allegro-offer-42');
      expect(result.status).toBe('draft');
    });

    it('should preserve existing errors when errors argument is omitted', async () => {
      const existingErrors: OfferCreationError[] = [{ code: 'OLD', message: 'old error' }];
      const existing = buildOrm({ errors: existingErrors });
      ormRepository.findOne.mockResolvedValue(existing);
      ormRepository.save.mockResolvedValue({
        ...existing,
        externalOfferId: 'allegro-offer-1',
        status: 'active',
      });

      await repository.updateExternalIdAndStatus('rec-uuid', 'allegro-offer-1', 'active');

      const savedArg = ormRepository.save.mock.calls[0][0] as OfferCreationRecordOrmEntity;
      expect(savedArg.errors).toEqual(existingErrors);
    });

    it('should clear errors when null is passed explicitly', async () => {
      const existing = buildOrm({ errors: [{ code: 'OLD', message: 'old' }] });
      ormRepository.findOne.mockResolvedValue(existing);
      ormRepository.save.mockResolvedValue({
        ...existing,
        externalOfferId: 'allegro-offer-2',
        status: 'draft',
        errors: null,
      });

      await repository.updateExternalIdAndStatus('rec-uuid', 'allegro-offer-2', 'draft', null);

      const savedArg = ormRepository.save.mock.calls[0][0] as OfferCreationRecordOrmEntity;
      expect(savedArg.errors).toBeNull();
    });

    it('should throw OfferCreationRecordNotFoundException when record is missing', async () => {
      ormRepository.findOne.mockResolvedValue(null);

      await expect(
        repository.updateExternalIdAndStatus('missing', 'x', 'draft'),
      ).rejects.toBeInstanceOf(OfferCreationRecordNotFoundException);
      expect(ormRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('toDomain mapping', () => {
    it('should preserve all fields round-trip', async () => {
      const errors: OfferCreationError[] = [{ code: 'X', message: 'y' }];
      ormRepository.findOne.mockResolvedValue(
        buildOrm({
          externalOfferId: 'external-1',
          status: 'validating',
          errors,
          publishImmediately: true,
        }),
      );

      const result = await repository.findById('rec-uuid');

      expect(result).toEqual(
        new OfferCreationRecord(
          'rec-uuid',
          'ol_variant_123',
          'conn-uuid',
          'external-1',
          'validating',
          errors,
          true,
          now,
          now,
        ),
      );
    });
  });
});
