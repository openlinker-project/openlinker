/**
 * Shop Product Status Snapshot Repository (#1845)
 *
 * TypeORM implementation of `ShopProductStatusSnapshotRepositoryPort`. Persists
 * the periodically-refreshed shop-side publication status of published products
 * and maps between the ORM row and the `ShopProductStatusSnapshot` domain entity.
 * Mapping is private; application services only see domain entities. The
 * shop-side sibling of `OfferStatusSnapshotRepository`.
 *
 * @module libs/core/src/listings/infrastructure/persistence/repositories
 * @implements {ShopProductStatusSnapshotRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ShopProductStatusSnapshot } from '../../../domain/entities/shop-product-status-snapshot.entity';
import type {
  ShopProductStatusSnapshotRepositoryPort,
  ShopProductStatusUpsertResult,
} from '../../../domain/ports/shop-product-status-snapshot-repository.port';
import type {
  ShopPublicationStatus,
  UpsertShopProductStatusSnapshotCommand,
} from '../../../domain/types/shop-product-status.types';
import { ShopProductStatusSnapshotOrmEntity } from '../entities/shop-product-status-snapshot.orm-entity';

@Injectable()
export class ShopProductStatusSnapshotRepository
  implements ShopProductStatusSnapshotRepositoryPort
{
  constructor(
    @InjectRepository(ShopProductStatusSnapshotOrmEntity)
    private readonly ormRepository: Repository<ShopProductStatusSnapshotOrmEntity>,
  ) {}

  async findByConnectionAndExternalProductId(
    connectionId: string,
    externalProductId: string,
  ): Promise<ShopProductStatusSnapshot | null> {
    const entity = await this.ormRepository.findOne({
      where: { connectionId, externalProductId },
    });
    return entity ? this.toDomain(entity) : null;
  }

  async upsert(
    command: UpsertShopProductStatusSnapshotCommand,
  ): Promise<ShopProductStatusUpsertResult> {
    // find-then-save (not atomic). Safe because the status-sync job is
    // effectively single-writer per connection: the scheduler dedups concurrent
    // runs via a per-minute idempotency key and advances the scan cursor
    // sequentially. A same-key race surfaces a unique-violation on the loser's
    // INSERT, which the runner's retry then resolves via the update path.
    const existing = await this.ormRepository.findOne({
      where: {
        connectionId: command.connectionId,
        externalProductId: command.externalProductId,
      },
    });
    const previousStatus = existing?.publicationStatus ?? null;

    const entity = existing ?? new ShopProductStatusSnapshotOrmEntity();
    entity.connectionId = command.connectionId;
    entity.externalProductId = command.externalProductId;
    entity.internalVariantId = command.internalVariantId;
    entity.publicationStatus = command.publicationStatus;
    entity.statusDetails = command.statusDetails;
    entity.lastStatusSyncedAt = command.lastStatusSyncedAt;

    const saved = await this.ormRepository.save(entity);
    return { snapshot: this.toDomain(saved), previousStatus };
  }

  async countByConnectionAndStatus(
    connectionId: string,
  ): Promise<Map<ShopPublicationStatus, number>> {
    const rows = await this.ormRepository
      .createQueryBuilder('snapshot')
      .select('snapshot.publicationStatus', 'publicationStatus')
      .addSelect('COUNT(*)', 'count')
      .where('snapshot.connectionId = :connectionId', { connectionId })
      .groupBy('snapshot.publicationStatus')
      .getRawMany<{ publicationStatus: ShopPublicationStatus; count: string }>();

    const result = new Map<ShopPublicationStatus, number>();
    for (const row of rows) {
      result.set(row.publicationStatus, Number(row.count));
    }
    return result;
  }

  async findByVariantIds(
    internalVariantIds: string[],
    connectionId?: string,
  ): Promise<ShopProductStatusSnapshot[]> {
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

  private toDomain(entity: ShopProductStatusSnapshotOrmEntity): ShopProductStatusSnapshot {
    return new ShopProductStatusSnapshot({
      id: entity.id,
      connectionId: entity.connectionId,
      externalProductId: entity.externalProductId,
      internalVariantId: entity.internalVariantId,
      publicationStatus: entity.publicationStatus,
      statusDetails: entity.statusDetails,
      lastStatusSyncedAt: entity.lastStatusSyncedAt,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    });
  }
}
