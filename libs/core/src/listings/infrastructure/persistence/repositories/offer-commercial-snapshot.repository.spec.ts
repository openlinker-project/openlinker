/**
 * Offer Commercial Snapshot Repository — Unit Tests
 *
 * Verifies the insert/update branches of `upsert`, mirroring
 * `offer-status-snapshot.repository.spec.ts` (#816). The TypeORM `Repository`
 * is mocked; the real-DB behaviour is exercised by the worker e2e int-spec.
 *
 * @module libs/core/src/listings/infrastructure/persistence/repositories
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';

import { OfferCommercialSnapshotRepository } from './offer-commercial-snapshot.repository';
import { OfferCommercialSnapshotOrmEntity } from '../entities/offer-commercial-snapshot.orm-entity';
import type { UpsertOfferCommercialSnapshotCommand } from '../../../domain/types/offer-commercial-snapshot.types';

describe('OfferCommercialSnapshotRepository', () => {
  let repository: OfferCommercialSnapshotRepository;
  let ormRepository: jest.Mocked<Repository<OfferCommercialSnapshotOrmEntity>>;

  const now = new Date('2026-08-11T10:00:00Z');

  const buildOrm = (
    overrides: Partial<OfferCommercialSnapshotOrmEntity> = {}
  ): OfferCommercialSnapshotOrmEntity => ({
    id: 'snap-uuid',
    connectionId: 'conn-uuid',
    externalOfferId: '7781562863',
    internalVariantId: 'ol_variant_123',
    price: '99.99',
    currency: 'PLN',
    availableQuantity: 5,
    lastCommercialSyncedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });

  const command: UpsertOfferCommercialSnapshotCommand = {
    connectionId: 'conn-uuid',
    externalOfferId: '7781562863',
    internalVariantId: 'ol_variant_123',
    price: '109.00',
    currency: 'PLN',
    availableQuantity: 3,
    lastCommercialSyncedAt: now,
  };

  beforeEach(async () => {
    const mockOrmRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
    } as unknown as jest.Mocked<Repository<OfferCommercialSnapshotOrmEntity>>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OfferCommercialSnapshotRepository,
        {
          provide: getRepositoryToken(OfferCommercialSnapshotOrmEntity),
          useValue: mockOrmRepo,
        },
      ],
    }).compile();

    repository = module.get(OfferCommercialSnapshotRepository);
    ormRepository = module.get(getRepositoryToken(OfferCommercialSnapshotOrmEntity));
  });

  describe('upsert', () => {
    it('inserts a new row when none exists for the key', async () => {
      ormRepository.findOne.mockResolvedValue(null);
      ormRepository.save.mockImplementation((entity) =>
        Promise.resolve(buildOrm(entity as Partial<OfferCommercialSnapshotOrmEntity>))
      );

      const result = await repository.upsert(command);

      expect(ormRepository.save).toHaveBeenCalledTimes(1);
      const saved = ormRepository.save.mock.calls[0][0] as OfferCommercialSnapshotOrmEntity;
      expect(saved.id).toBeUndefined();
      expect(saved.price).toBe('109.00');
      expect(saved.currency).toBe('PLN');
      expect(saved.availableQuantity).toBe(3);
      expect(saved.lastCommercialSyncedAt).toBe(now);
      expect(result.price).toBe('109.00');
      expect(result.availableQuantity).toBe(3);
    });

    it('updates the existing row in place when the key already exists', async () => {
      ormRepository.findOne.mockResolvedValue(buildOrm({ price: '50.00', availableQuantity: 1 }));
      ormRepository.save.mockImplementation((entity) =>
        Promise.resolve(entity as OfferCommercialSnapshotOrmEntity)
      );

      const result = await repository.upsert(command);

      const saved = ormRepository.save.mock.calls[0][0] as OfferCommercialSnapshotOrmEntity;
      expect(saved.id).toBe('snap-uuid');
      expect(saved.price).toBe('109.00');
      expect(saved.availableQuantity).toBe(3);
      expect(result.price).toBe('109.00');
      expect(result.availableQuantity).toBe(3);
    });

    it('persists a null price and a null quantity rather than coercing either to zero', async () => {
      ormRepository.findOne.mockResolvedValue(null);
      ormRepository.save.mockImplementation((entity) =>
        Promise.resolve(buildOrm(entity as Partial<OfferCommercialSnapshotOrmEntity>))
      );

      const result = await repository.upsert({
        ...command,
        price: null,
        currency: null,
        availableQuantity: null,
      });

      const saved = ormRepository.save.mock.calls[0][0] as OfferCommercialSnapshotOrmEntity;
      expect(saved.price).toBeNull();
      expect(saved.currency).toBeNull();
      expect(saved.availableQuantity).toBeNull();
      expect(saved.lastCommercialSyncedAt).toBe(now);
      expect(result.price).toBeNull();
      expect(result.availableQuantity).toBeNull();
    });
  });
});
