/**
 * Offer Status Snapshot Repository — Unit Tests
 *
 * Verifies the keyed read, the insert/update branches of `upsert`, domain
 * mapping, and the status-count aggregation. The TypeORM `Repository` is
 * mocked (mirrors `offer-creation-record.repository.spec.ts`); the real-DB
 * behaviour is exercised by the worker e2e int-spec.
 *
 * @module libs/core/src/listings/infrastructure/persistence/repositories
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';

import { OfferStatusSnapshotRepository } from './offer-status-snapshot.repository';
import { OfferStatusSnapshotOrmEntity } from '../entities/offer-status-snapshot.orm-entity';
import type { UpsertOfferStatusSnapshotCommand } from '../../../domain/types/offer-status-snapshot.types';

describe('OfferStatusSnapshotRepository', () => {
  let repository: OfferStatusSnapshotRepository;
  let ormRepository: jest.Mocked<Repository<OfferStatusSnapshotOrmEntity>>;

  const now = new Date('2026-05-20T10:00:00Z');

  const buildOrm = (
    overrides: Partial<OfferStatusSnapshotOrmEntity> = {}
  ): OfferStatusSnapshotOrmEntity => ({
    id: 'snap-uuid',
    connectionId: 'conn-uuid',
    externalOfferId: '7781562863',
    internalVariantId: 'ol_variant_123',
    publicationStatus: 'active',
    statusDetails: null,
    lastStatusSyncedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });

  const command: UpsertOfferStatusSnapshotCommand = {
    connectionId: 'conn-uuid',
    externalOfferId: '7781562863',
    internalVariantId: 'ol_variant_123',
    publicationStatus: 'ended',
    statusDetails: { validationMessages: ['gone'] },
    lastStatusSyncedAt: now,
  };

  beforeEach(async () => {
    const mockOrmRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
      createQueryBuilder: jest.fn(),
    } as unknown as jest.Mocked<Repository<OfferStatusSnapshotOrmEntity>>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OfferStatusSnapshotRepository,
        {
          provide: getRepositoryToken(OfferStatusSnapshotOrmEntity),
          useValue: mockOrmRepo,
        },
      ],
    }).compile();

    repository = module.get(OfferStatusSnapshotRepository);
    ormRepository = module.get(getRepositoryToken(OfferStatusSnapshotOrmEntity));
  });

  describe('findByConnectionAndExternalOfferId', () => {
    it('maps the ORM row to a domain entity when found', async () => {
      ormRepository.findOne.mockResolvedValue(buildOrm());

      const result = await repository.findByConnectionAndExternalOfferId('conn-uuid', '7781562863');

      expect(ormRepository.findOne).toHaveBeenCalledWith({
        where: { connectionId: 'conn-uuid', externalOfferId: '7781562863' },
      });
      expect(result).not.toBeNull();
      expect(result?.id).toBe('snap-uuid');
      expect(result?.publicationStatus).toBe('active');
    });

    it('returns null when not found', async () => {
      ormRepository.findOne.mockResolvedValue(null);

      const result = await repository.findByConnectionAndExternalOfferId('conn-uuid', 'missing');

      expect(result).toBeNull();
    });
  });

  describe('upsert', () => {
    it('inserts a new row when none exists for the key', async () => {
      ormRepository.findOne.mockResolvedValue(null);
      ormRepository.save.mockImplementation((entity) =>
        Promise.resolve(buildOrm(entity as Partial<OfferStatusSnapshotOrmEntity>))
      );

      const result = await repository.upsert(command);

      expect(ormRepository.save).toHaveBeenCalledTimes(1);
      const saved = ormRepository.save.mock.calls[0][0] as OfferStatusSnapshotOrmEntity;
      expect(saved.id).toBeUndefined();
      expect(saved.publicationStatus).toBe('ended');
      expect(saved.statusDetails).toEqual({ validationMessages: ['gone'] });
      expect(result.snapshot.publicationStatus).toBe('ended');
      expect(result.previousStatus).toBeNull();
    });

    it('updates the existing row in place when the key already exists', async () => {
      ormRepository.findOne.mockResolvedValue(buildOrm({ publicationStatus: 'active' }));
      ormRepository.save.mockImplementation((entity) =>
        Promise.resolve(entity as OfferStatusSnapshotOrmEntity)
      );

      const result = await repository.upsert(command);

      const saved = ormRepository.save.mock.calls[0][0] as OfferStatusSnapshotOrmEntity;
      expect(saved.id).toBe('snap-uuid');
      expect(saved.publicationStatus).toBe('ended');
      expect(result.snapshot.publicationStatus).toBe('ended');
      expect(result.previousStatus).toBe('active');
    });
  });

  describe('countByConnectionAndStatus', () => {
    it('maps grouped raw rows to a status → count map', async () => {
      const qb = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          { publicationStatus: 'active', count: '3' },
          { publicationStatus: 'ended', count: '1' },
        ]),
      };
      ormRepository.createQueryBuilder.mockReturnValue(
        qb as unknown as ReturnType<Repository<OfferStatusSnapshotOrmEntity>['createQueryBuilder']>
      );

      const result = await repository.countByConnectionAndStatus('conn-uuid');

      expect(result.get('active')).toBe(3);
      expect(result.get('ended')).toBe(1);
      expect(result.size).toBe(2);
    });
  });
});
