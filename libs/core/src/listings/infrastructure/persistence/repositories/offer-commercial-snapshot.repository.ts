/**
 * Offer Commercial Snapshot Repository
 *
 * TypeORM implementation of `OfferCommercialSnapshotRepositoryPort` (#2024).
 * Persists the periodically-refreshed channel-side price/currency/available
 * quantity of mapped offers and maps between the ORM row and the
 * `OfferCommercialSnapshot` domain entity. Mapping is private; application
 * services only see domain entities.
 *
 * @module libs/core/src/listings/infrastructure/persistence/repositories
 * @implements {OfferCommercialSnapshotRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OfferCommercialSnapshot } from '../../../domain/entities/offer-commercial-snapshot.entity';
import type { OfferCommercialSnapshotRepositoryPort } from '../../../domain/ports/offer-commercial-snapshot-repository.port';
import type { UpsertOfferCommercialSnapshotCommand } from '../../../domain/types/offer-commercial-snapshot.types';
import { OfferCommercialSnapshotOrmEntity } from '../entities/offer-commercial-snapshot.orm-entity';

@Injectable()
export class OfferCommercialSnapshotRepository implements OfferCommercialSnapshotRepositoryPort {
  constructor(
    @InjectRepository(OfferCommercialSnapshotOrmEntity)
    private readonly ormRepository: Repository<OfferCommercialSnapshotOrmEntity>
  ) {}

  async upsert(command: UpsertOfferCommercialSnapshotCommand): Promise<OfferCommercialSnapshot> {
    // find-then-save (not atomic), matching OfferStatusSnapshotRepository —
    // safe under the same single-writer-per-connection posture the status
    // sync job already relies on (see that repository's upsert docblock). The
    // one caller that can race it treats a failed write as non-fatal, so a
    // losing INSERT costs one skipped observation, not a wedged sync.
    //
    // Deliberately no QueryFailedError → domain-error translation: the sole
    // caller catches every failure mode identically and warn-logs it, so a
    // dedicated domain error would be a type nothing ever branches on. Add one
    // with the first caller that needs to tell the failures apart.
    const existing = await this.ormRepository.findOne({
      where: {
        connectionId: command.connectionId,
        externalOfferId: command.externalOfferId,
      },
    });

    const entity = existing ?? new OfferCommercialSnapshotOrmEntity();
    entity.connectionId = command.connectionId;
    entity.externalOfferId = command.externalOfferId;
    entity.internalVariantId = command.internalVariantId;
    entity.price = command.price;
    entity.currency = command.currency;
    entity.availableQuantity = command.availableQuantity;
    entity.lastCommercialSyncedAt = command.lastCommercialSyncedAt;

    const saved = await this.ormRepository.save(entity);
    return this.toDomain(saved);
  }

  private toDomain(entity: OfferCommercialSnapshotOrmEntity): OfferCommercialSnapshot {
    return new OfferCommercialSnapshot({
      id: entity.id,
      connectionId: entity.connectionId,
      externalOfferId: entity.externalOfferId,
      internalVariantId: entity.internalVariantId,
      price: entity.price,
      currency: entity.currency,
      availableQuantity: entity.availableQuantity,
      lastCommercialSyncedAt: entity.lastCommercialSyncedAt,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    });
  }
}
