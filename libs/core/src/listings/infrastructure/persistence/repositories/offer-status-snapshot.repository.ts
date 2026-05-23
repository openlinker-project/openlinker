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
    // find-then-save (not atomic). Safe because the status-sync job is
    // effectively single-writer per connection: the scheduler dedups
    // concurrent runs via a per-minute idempotency key and advances the scan
    // cursor sequentially. A same-key race would surface a unique-violation on
    // the loser's INSERT, which the runner's retry then resolves via the
    // update path on the next pass. The prior status is captured here (one
    // read) so the service can detect a transition without a second query.
    const existing = await this.ormRepository.findOne({
      where: {
        connectionId: command.connectionId,
        externalOfferId: command.externalOfferId,
      },
    });
    const previousStatus = existing?.publicationStatus ?? null;

    const entity = existing ?? new OfferStatusSnapshotOrmEntity();
    entity.connectionId = command.connectionId;
    entity.externalOfferId = command.externalOfferId;
    entity.internalVariantId = command.internalVariantId;
    entity.publicationStatus = command.publicationStatus;
    entity.statusDetails = command.statusDetails;
    entity.lastStatusSyncedAt = command.lastStatusSyncedAt;

    const saved = await this.ormRepository.save(entity);
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
