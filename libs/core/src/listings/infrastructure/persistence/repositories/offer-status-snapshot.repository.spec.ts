/**
 * Offer Status Snapshot Repository — Unit Tests
 *
 * Verifies the keyed read, the lock-then-upsert `upsert` (#2032 review round
 * 2, finding 5 - atomic, not find-then-save), domain mapping, and the
 * status-count aggregation. The TypeORM `Repository`/`EntityManager` are
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

  /**
   * A fake transactional `EntityManager.getRepository(...)` result: a lockable
   * query builder (`existingRow`) plus `upsert`/`findOneOrFail` mocks. Handed
   * to `manager.transaction`'s callback in place of a real transaction.
   */
  function buildTxRepo(existingRow: OfferStatusSnapshotOrmEntity | null): {
    createQueryBuilder: jest.Mock;
    upsert: jest.Mock;
    findOneOrFail: jest.Mock;
  } {
    const qb = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(existingRow),
    };
    return {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
      upsert: jest.fn().mockResolvedValue({} as never),
      findOneOrFail: jest.fn(),
    };
  }

  beforeEach(async () => {
    const mockOrmRepo = {
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(),
      manager: {
        transaction: jest.fn(),
        getRepository: jest.fn(),
      },
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
    /** Wires `ormRepository.manager.transaction` to run its callback against `txRepo`. */
    function mockTransaction(txRepo: ReturnType<typeof buildTxRepo>): void {
      (
        ormRepository.manager as unknown as {
          transaction: jest.Mock;
          getRepository: jest.Mock;
        }
      ).transaction.mockImplementation((cb: (m: unknown) => unknown) =>
        cb({ getRepository: jest.fn().mockReturnValue(txRepo) })
      );
    }

    it('locks for update, then upserts atomically - inserting when none exists for the key', async () => {
      const txRepo = buildTxRepo(null);
      txRepo.findOneOrFail.mockResolvedValue(buildOrm({ publicationStatus: 'ended' }));
      mockTransaction(txRepo);

      const result = await repository.upsert(command);

      expect(txRepo.upsert).toHaveBeenCalledTimes(1);
      const [row, options] = txRepo.upsert.mock.calls[0];
      expect(options).toEqual({ conflictPaths: ['connectionId', 'externalOfferId'] });
      expect(row).toMatchObject({
        connectionId: 'conn-uuid',
        externalOfferId: '7781562863',
        publicationStatus: 'ended',
        statusDetails: { validationMessages: ['gone'] },
      });
      expect(typeof (row as { updatedAt: () => string }).updatedAt).toBe('function');
      expect(result.snapshot.publicationStatus).toBe('ended');
      expect(result.previousStatus).toBeNull();
    });

    it('locks the existing row before upserting, reporting its status as previousStatus', async () => {
      const txRepo = buildTxRepo(buildOrm({ publicationStatus: 'active' }));
      txRepo.findOneOrFail.mockResolvedValue(buildOrm({ publicationStatus: 'ended' }));
      mockTransaction(txRepo);

      const result = await repository.upsert(command);

      expect(txRepo.upsert).toHaveBeenCalledTimes(1);
      expect(result.snapshot.publicationStatus).toBe('ended');
      expect(result.previousStatus).toBe('active');
    });

    it('runs the lock read and the upsert inside the same transaction, never find-then-save', async () => {
      const txRepo = buildTxRepo(null);
      txRepo.findOneOrFail.mockResolvedValue(buildOrm({ publicationStatus: 'ended' }));
      mockTransaction(txRepo);

      await repository.upsert(command);

      expect(
        (ormRepository.manager as unknown as { transaction: jest.Mock }).transaction
      ).toHaveBeenCalledTimes(1);
      const qb = txRepo.createQueryBuilder.mock.results[0].value as { setLock: jest.Mock };
      expect(qb.setLock).toHaveBeenCalledWith('pessimistic_write');
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
