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
import { OfferStatusSnapshotUpsertFailedError } from '../../../domain/exceptions/offer-status-snapshot-upsert-failed.exception';
import type {
  OfferStatusSnapshotRepositoryPort,
  OfferStatusUpsertResult,
} from '../../../domain/ports/offer-status-snapshot-repository.port';
import type { UpsertOfferStatusSnapshotCommand } from '../../../domain/types/offer-status-snapshot.types';
import type { OfferPublicationStatus } from '../../../domain/types/offer-status-read.types';
import { OfferStatusSnapshotOrmEntity } from '../entities/offer-status-snapshot.orm-entity';

/** Physical table name, referenced by the guarded `ON CONFLICT` assignments. */
const TABLE = 'offer_status_snapshots';

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
    // The prior status is captured here (one read) so the service can detect a
    // transition without a second query. It is deliberately NOT the basis of
    // the write — see the guard below.
    const existing = await this.ormRepository.findOne({
      where: {
        connectionId: command.connectionId,
        externalOfferId: command.externalOfferId,
      },
    });
    const previousStatus = existing?.publicationStatus ?? null;

    // Raw parameterized INSERT … ON CONFLICT DO UPDATE rather than
    // find-then-save. Until #2039 this table had ONE writer (the hourly scan,
    // serialised per connection by its own idempotency key + cursor), so a
    // non-atomic read-modify-write was safe. It now has three deliberately
    // decoupled writers — the scan, the single-offer refresh, and the create
    // path (create response + the creation poller's `active` terminal) — and
    // nothing orders them, so the assignment resolves by OBSERVATION FRESHNESS
    // instead of arrival order (`docs/lessons.md`, #1916 precedent).
    //
    // Freshness, not status rank: `active → ended → active` is a legitimate
    // sequence, so ranking the status values (as `webhook_deliveries` does for
    // its monotonic lifecycle) would be wrong here. `<=` keeps a same-instant
    // rewrite effective, and `GREATEST` makes the timestamp itself monotonic so
    // a late-arriving stale observation cannot drag the row backwards.
    //
    // Column names are a fixed whitelist of entity fields (never user input);
    // every value is a bound parameter. `QueryBuilder.insert()` is avoided on
    // purpose: its lazy `require()` of InsertQueryBuilder can resolve to
    // `undefined` under jest's per-file module sandbox (#1511).
    const guard = `${TABLE}."lastStatusSyncedAt" <= EXCLUDED."lastStatusSyncedAt"`;
    const freshest = (column: string): string =>
      `"${column}" = CASE WHEN ${guard} THEN EXCLUDED."${column}" ELSE ${TABLE}."${column}" END`;

    await this.ormRepository.query(
      `INSERT INTO ${TABLE} ("connectionId", "externalOfferId", "internalVariantId", "publicationStatus", "statusDetails", "lastStatusSyncedAt")
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT ("externalOfferId", "connectionId")
       DO UPDATE SET ${freshest('internalVariantId')}, ${freshest('publicationStatus')}, ${freshest('statusDetails')},
         "lastStatusSyncedAt" = GREATEST(${TABLE}."lastStatusSyncedAt", EXCLUDED."lastStatusSyncedAt"),
         "updatedAt" = now()`,
      [
        command.connectionId,
        command.externalOfferId,
        command.internalVariantId,
        command.publicationStatus,
        command.statusDetails === null ? null : JSON.stringify(command.statusDetails),
        command.lastStatusSyncedAt,
      ]
    );

    const saved = await this.ormRepository.findOne({
      where: {
        connectionId: command.connectionId,
        externalOfferId: command.externalOfferId,
      },
    });
    if (!saved) {
      throw new OfferStatusSnapshotUpsertFailedError(
        command.connectionId,
        command.externalOfferId
      );
    }
    return { snapshot: this.toDomain(saved), previousStatus };
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
