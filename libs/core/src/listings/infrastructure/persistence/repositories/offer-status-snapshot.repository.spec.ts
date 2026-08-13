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
import { OfferStatusSnapshotUpsertFailedError } from '../../../domain/exceptions/offer-status-snapshot-upsert-failed.exception';
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
      // The upsert returns the post-write `lastStatusSyncedAt`; equal to the
      // command's instant ⇒ the freshness guard accepted the observation.
      query: jest.fn().mockResolvedValue([{ lastStatusSyncedAt: now }]),
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
    // The freshness guard itself lives in SQL, so it is asserted in
    // `apps/api/test/integration/listings-offer-status-snapshot.int-spec.ts`
    // against a real Postgres. These unit tests cover the surrounding
    // contract: the statement shape, the bound parameters, `previousStatus`,
    // and the read-back mapping.
    it('issues a freshness-guarded ON CONFLICT upsert with bound parameters', async () => {
      ormRepository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(buildOrm({ publicationStatus: 'ended' }));

      const result = await repository.upsert(command);

      expect(ormRepository.query).toHaveBeenCalledTimes(1);
      const [sql, params] = ormRepository.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('ON CONFLICT ("externalOfferId", "connectionId")');
      expect(sql).toContain('"lastStatusSyncedAt" <= EXCLUDED."lastStatusSyncedAt"');
      expect(sql).toContain('GREATEST');
      expect(params).toEqual([
        'conn-uuid',
        '7781562863',
        'ol_variant_123',
        'ended',
        JSON.stringify({ validationMessages: ['gone'] }),
        now,
      ]);
      expect(sql).toContain('RETURNING "lastStatusSyncedAt"');
      expect(result.snapshot.publicationStatus).toBe('ended');
      expect(result.previousStatus).toBeNull();
      expect(result.applied).toBe(true);
    });

    it('reports applied=false when the guard kept a fresher stored observation', async () => {
      const fresher = new Date(now.getTime() + 5_000);
      ormRepository.query.mockResolvedValue([{ lastStatusSyncedAt: fresher }]);
      ormRepository.findOne
        .mockResolvedValueOnce(buildOrm({ publicationStatus: 'active' }))
        .mockResolvedValueOnce(
          buildOrm({ publicationStatus: 'active', lastStatusSyncedAt: fresher })
        );

      const result = await repository.upsert(command);

      // The stored row wins, so the caller must not narrate `active → ended`.
      expect(result.applied).toBe(false);
      expect(result.snapshot.publicationStatus).toBe('active');
    });

    it('reports the status the row held before the write', async () => {
      ormRepository.findOne
        .mockResolvedValueOnce(buildOrm({ publicationStatus: 'active' }))
        .mockResolvedValueOnce(buildOrm({ publicationStatus: 'ended' }));

      const result = await repository.upsert(command);

      expect(result.previousStatus).toBe('active');
      expect(result.snapshot.publicationStatus).toBe('ended');
    });

    it('binds a null statusDetails rather than the string "null"', async () => {
      ormRepository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(buildOrm({ statusDetails: null }));

      await repository.upsert({ ...command, statusDetails: null });

      const [, params] = ormRepository.query.mock.calls[0] as [string, unknown[]];
      expect(params[4]).toBeNull();
    });

    it('raises a domain error when the written row cannot be read back', async () => {
      ormRepository.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

      await expect(repository.upsert(command)).rejects.toThrow(
        OfferStatusSnapshotUpsertFailedError
      );
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
