/**
 * Offer Status Snapshot Repository
 *
 * TypeORM implementation of `OfferStatusSnapshotRepositoryPort` (#816).
 * Persists the periodically-refreshed marketplace publication status of mapped
 * offers and maps between the ORM row and the `OfferStatusSnapshot` domain
 * entity. Mapping is private; application services only see domain entities.
 *
 * @module libs/core/src/listings/infrastructure/persistence/repositories
 * @implements {OfferStatusSnapshotRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OfferStatusSnapshot } from '../../../domain/entities/offer-status-snapshot.entity';
import type {
  OfferStatusSnapshotRepositoryPort,
  OfferStatusUpsertResult,
} from '../../../domain/ports/offer-status-snapshot-repository.port';
import type { UpsertOfferStatusSnapshotCommand } from '../../../domain/types/offer-status-snapshot.types';
import type { OfferPublicationStatus } from '../../../domain/types/offer-status-read.types';
import { OfferStatusSnapshotOrmEntity } from '../entities/offer-status-snapshot.orm-entity';

@Injectable()
export class OfferStatusSnapshotRepository implements OfferStatusSnapshotRepositoryPort {
  constructor(
    @InjectRepository(OfferStatusSnapshotOrmEntity)
    private readonly ormRepository: Repository<OfferStatusSnapshotOrmEntity>
  ) {}

  async findByConnectionAndExternalOfferId(
    connectionId: string,
    externalOfferId: string
  ): Promise<OfferStatusSnapshot | null> {
    const entity = await this.ormRepository.findOne({
      where: { connectionId, externalOfferId },
    });
    return entity ? this.toDomain(entity) : null;
  }

  async upsert(command: UpsertOfferStatusSnapshotCommand): Promise<OfferStatusUpsertResult> {
    // Lock-then-upsert, NOT find-then-save (#2032 review round 2, finding 5):
    // `refreshOne` is reachable from three independent triggers - the hourly
    // scan, the delayed post-creation refresh
    // (`marketplace-offer-refresh-snapshot.handler.ts`), and the operator
    // "Refresh status" endpoint - exactly the race `OfferCommercialSnapshotRepository`
    // was fixed for in this same PR, over the SAME `refreshOne`/`sync` call
    // sites and the SAME `(connectionId, externalOfferId)` key. Find-then-save
    // here was worse than a stale comment: on a never-before-synced offer -
    // precisely a row sitting in the operator-facing `Unsynced` tab an
    // operator is now likely to manually "Refresh status" on - a genuine
    // concurrent first-INSERT race threw an uncaught unique-violation out of
    // `sync()`'s per-page loop (no try/catch there, unlike the commercial
    // write), aborting the whole scan-page job rather than just the one offer.
    //
    // A plain atomic `upsert()` (as used for the commercial table) would lose
    // `previousStatus`, which the caller needs for transition-detection
    // logging - Postgres' `INSERT ... ON CONFLICT ... RETURNING` only exposes
    // the POST-update row. So this locks the row first: `pessimistic_write`
    // on an EXISTING row serializes concurrent updates (the second racer
    // waits, then reads the first's committed write as its own
    // `previousStatus` - correct linearization). On a genuine concurrent
    // first-INSERT (nothing to lock yet), `upsert()`'s own `ON CONFLICT DO
    // UPDATE` still resolves the write atomically with no unique-violation;
    // both racers may report `previousStatus: null` for what is, from either
    // transaction's own view, a genuine first observation - a possible
    // redundant "first observation" log line, never a thrown error or a lost
    // write.
    return this.ormRepository.manager.transaction(async (manager) => {
      const repo = manager.getRepository(OfferStatusSnapshotOrmEntity);
      const existing = await repo
        .createQueryBuilder('snapshot')
        .setLock('pessimistic_write')
        .where('snapshot.connectionId = :connectionId', { connectionId: command.connectionId })
        .andWhere('snapshot.externalOfferId = :externalOfferId', {
          externalOfferId: command.externalOfferId,
        })
        .getOne();
      const previousStatus = existing?.publicationStatus ?? null;

      await repo.upsert(
        {
          connectionId: command.connectionId,
          externalOfferId: command.externalOfferId,
          internalVariantId: command.internalVariantId,
          publicationStatus: command.publicationStatus,
          statusDetails: command.statusDetails,
          lastStatusSyncedAt: command.lastStatusSyncedAt,
          updatedAt: () => 'now()',
        },
        { conflictPaths: ['connectionId', 'externalOfferId'] }
      );

      const saved = await repo.findOneOrFail({
        where: {
          connectionId: command.connectionId,
          externalOfferId: command.externalOfferId,
        },
      });
      return { snapshot: this.toDomain(saved), previousStatus };
    });
  }

  async countByConnectionAndStatus(
    connectionId: string
  ): Promise<Map<OfferPublicationStatus, number>> {
    const rows = await this.ormRepository
      .createQueryBuilder('snapshot')
      .select('snapshot.publicationStatus', 'publicationStatus')
      .addSelect('COUNT(*)', 'count')
      .where('snapshot.connectionId = :connectionId', { connectionId })
      .groupBy('snapshot.publicationStatus')
      .getRawMany<{ publicationStatus: OfferPublicationStatus; count: string }>();

    const result = new Map<OfferPublicationStatus, number>();
    for (const row of rows) {
      result.set(row.publicationStatus, Number(row.count));
    }
    return result;
  }

  async findByVariantIds(
    internalVariantIds: string[],
    connectionId?: string
  ): Promise<OfferStatusSnapshot[]> {
    if (internalVariantIds.length === 0) {
      return [];
    }
    const query = this.ormRepository
      .createQueryBuilder('snapshot')
      .where('snapshot.internalVariantId IN (:...internalVariantIds)', { internalVariantIds });
    if (connectionId !== undefined) {
      query.andWhere('snapshot.connectionId = :connectionId', { connectionId });
    }
    const entities = await query.getMany();
    return entities.map((entity) => this.toDomain(entity));
  }

  private toDomain(entity: OfferStatusSnapshotOrmEntity): OfferStatusSnapshot {
    return new OfferStatusSnapshot({
      id: entity.id,
      connectionId: entity.connectionId,
      externalOfferId: entity.externalOfferId,
      internalVariantId: entity.internalVariantId,
      publicationStatus: entity.publicationStatus,
      statusDetails: entity.statusDetails,
      lastStatusSyncedAt: entity.lastStatusSyncedAt,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    });
  }
}
