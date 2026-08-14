/**
 * Offer Commercial Snapshot Repository
 *
 * TypeORM implementation of `OfferCommercialSnapshotRepositoryPort` (#2024).
 * Persists the periodically-refreshed channel-side price/currency/available
 * quantity of mapped offers via an atomic upsert (#2032 review thread 5). No
 * caller reads a mapped domain entity back, so this repository writes only -
 * see `OfferCommercialSnapshotRepositoryPort` for why.
 *
 * @module libs/core/src/listings/infrastructure/persistence/repositories
 * @implements {OfferCommercialSnapshotRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { OfferCommercialSnapshotRepositoryPort } from '../../../domain/ports/offer-commercial-snapshot-repository.port';
import type { UpsertOfferCommercialSnapshotCommand } from '../../../domain/types/offer-commercial-snapshot.types';
import { OfferCommercialSnapshotOrmEntity } from '../entities/offer-commercial-snapshot.orm-entity';

@Injectable()
export class OfferCommercialSnapshotRepository implements OfferCommercialSnapshotRepositoryPort {
  constructor(
    @InjectRepository(OfferCommercialSnapshotOrmEntity)
    private readonly ormRepository: Repository<OfferCommercialSnapshotOrmEntity>
  ) {}

  async upsert(command: UpsertOfferCommercialSnapshotCommand): Promise<void> {
    // Atomic `INSERT ... ON CONFLICT DO UPDATE` (#2032 review thread 5) - NOT
    // find-then-save. Unlike `OfferStatusSnapshotRepository.upsert` (which
    // reads first because its caller needs the row's PREVIOUS status to
    // detect a transition), this row has exactly one writer per key and no
    // caller reads the persisted entity back, so there is nothing the find
    // half of find-then-save would have bought. And unlike that sibling's
    // effectively-single-writer posture, `refreshOne` (this table's sole
    // write path) is reachable from three independent triggers - the hourly
    // scan, the delayed post-creation refresh, and the operator "Refresh
    // status" endpoint - so a genuine INSERT/INSERT race is reachable. Under
    // find-then-save the losing INSERT hit a unique-violation that
    // `upsertCommercialSnapshot` counts into `commercialFailed`, a counter
    // whose docblock reserves non-zero for a SYSTEMIC failure (adapter/schema
    // breakage) - ordinary concurrency should never trip it.
    await this.ormRepository.upsert(
      {
        connectionId: command.connectionId,
        externalOfferId: command.externalOfferId,
        internalVariantId: command.internalVariantId,
        price: command.price,
        currency: command.currency,
        availableQuantity: command.availableQuantity,
        lastCommercialSyncedAt: command.lastCommercialSyncedAt,
        // TypeORM 0.3.17 (pinned) does not bump `@UpdateDateColumn` on the
        // upsert-update path (fixed upstream in 0.3.18, typeorm#10458) -
        // stamped explicitly so a merge-path write is not silently missing
        // from `updatedAt`.
        updatedAt: () => 'now()',
      },
      { conflictPaths: ['connectionId', 'externalOfferId'] }
    );
  }
}
