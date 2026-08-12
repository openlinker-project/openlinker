/**
 * Offer Commercial Snapshot Repository — Unit Tests
 *
 * Verifies `upsert` issues an atomic `INSERT ... ON CONFLICT DO UPDATE`
 * (#2032 review thread 5), not find-then-save: `refreshOne` is reachable from
 * three independent triggers (hourly scan, delayed post-creation refresh,
 * operator "Refresh status"), so a same-key race is reachable and must
 * resolve without a unique-violation. No caller reads the persisted row
 * back, so the repository writes only.
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
      upsert: jest.fn(),
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
    it('issues an atomic upsert conflicting on (connectionId, externalOfferId)', async () => {
      ormRepository.upsert.mockResolvedValue({} as never);

      await repository.upsert(command);

      expect(ormRepository.upsert).toHaveBeenCalledTimes(1);
      const [row, options] = ormRepository.upsert.mock.calls[0];
      expect(options).toEqual({ conflictPaths: ['connectionId', 'externalOfferId'] });
      expect(row).toMatchObject({
        connectionId: 'conn-uuid',
        externalOfferId: '7781562863',
        internalVariantId: 'ol_variant_123',
        price: '109.00',
        currency: 'PLN',
        availableQuantity: 3,
        lastCommercialSyncedAt: now,
      });
    });

    it('stamps updatedAt with a raw now() fragment, since TypeORM 0.3.17 does not bump it on the upsert-update path', async () => {
      ormRepository.upsert.mockResolvedValue({} as never);

      await repository.upsert(command);

      const [row] = ormRepository.upsert.mock.calls[0];
      expect(typeof (row as { updatedAt?: unknown }).updatedAt).toBe('function');
      expect((row as { updatedAt: () => string }).updatedAt()).toBe('now()');
    });

    it('persists a null price and a null quantity rather than coercing either to zero', async () => {
      ormRepository.upsert.mockResolvedValue({} as never);

      await repository.upsert({
        ...command,
        price: null,
        currency: null,
        availableQuantity: null,
      });

      const [row] = ormRepository.upsert.mock.calls[0];
      expect(row).toMatchObject({ price: null, currency: null, availableQuantity: null });
    });

    it('resolves to void - no caller reads the persisted row back', async () => {
      ormRepository.upsert.mockResolvedValue({} as never);

      const result = await repository.upsert(command);

      expect(result).toBeUndefined();
    });
  });
});
