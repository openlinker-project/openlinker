/**
 * Listing Sale Hold Repository (#3962)
 *
 * TypeORM implementation of `ListingSaleHoldRepositoryPort`. `recordActive`
 * is a raw, parameterised `INSERT ... ON CONFLICT DO UPDATE` against the
 * partial unique index, so the deletion trigger and the sweep cannot race
 * each other into two active holds for one listing. Raw SQL rather than the
 * query builder: the builder's lazy `InsertQueryBuilder` require fails under
 * ts-jest when called from a long-lived worker loop. Re-recording the same
 * method and outcome (the hourly sweep) keeps the original `appliedAt`, so
 * "off sale since" stays the moment it actually happened.
 *
 * @module libs/core/src/listings/infrastructure/persistence/repositories
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';

import { ListingSaleHold } from '../../../domain/entities/listing-sale-hold.entity';
import type { ListingSaleHoldRepositoryPort } from '../../../domain/ports/listing-sale-hold-repository.port';
import type { ListingRef, RecordListingSaleHoldInput } from '../../../domain/types/listing-sale-hold.types';
import { ListingSaleHoldOrmEntity } from '../entities/listing-sale-hold.orm-entity';

@Injectable()
export class ListingSaleHoldRepository implements ListingSaleHoldRepositoryPort {
  constructor(
    @InjectRepository(ListingSaleHoldOrmEntity)
    private readonly ormRepository: Repository<ListingSaleHoldOrmEntity>,
  ) {}

  async recordActive(input: RecordListingSaleHoldInput): Promise<ListingSaleHold> {
    const rows = (await this.ormRepository.query(
      `INSERT INTO "listing_sale_holds"
         ("connectionId", "entityType", "externalId", "externalParentId", "internalProductId",
          "internalVariantId", "method", "outcome", "outcomeReason", "staleAt", "appliedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT ("connectionId", "entityType", "externalId") WHERE "releasedAt" IS NULL
       DO UPDATE SET
         "externalParentId" = EXCLUDED."externalParentId",
         "internalVariantId" = EXCLUDED."internalVariantId",
         "method" = EXCLUDED."method",
         "outcome" = EXCLUDED."outcome",
         "outcomeReason" = EXCLUDED."outcomeReason",
         "staleAt" = EXCLUDED."staleAt",
         "appliedAt" = CASE
           WHEN "listing_sale_holds"."method" = EXCLUDED."method"
            AND "listing_sale_holds"."outcome" = EXCLUDED."outcome"
           THEN "listing_sale_holds"."appliedAt"
           ELSE EXCLUDED."appliedAt"
         END,
         "updatedAt" = now()
       RETURNING *`,
      [
        input.connectionId,
        input.entityType,
        input.externalId,
        input.externalParentId,
        input.internalProductId,
        input.internalVariantId,
        input.method,
        input.outcome,
        input.outcomeReason,
        input.staleAt,
        input.appliedAt,
      ],
    )) as ListingSaleHoldOrmEntity[];
    return this.toDomain(rows[0]);
  }

  async findActiveByListings(refs: readonly ListingRef[]): Promise<ListingSaleHold[]> {
    if (refs.length === 0) return [];
    const rows = await this.ormRepository.find({
      where: refs.map((ref) => ({
        connectionId: ref.connectionId,
        entityType: ref.entityType,
        externalId: ref.externalId,
        releasedAt: IsNull(),
      })),
    });
    return rows.map((row) => this.toDomain(row));
  }

  async findActiveByProductId(internalProductId: string): Promise<ListingSaleHold[]> {
    const rows = await this.ormRepository.find({
      where: { internalProductId, releasedAt: IsNull() },
      order: { appliedAt: 'ASC' },
    });
    return rows.map((row) => this.toDomain(row));
  }

  async findByIdsForProduct(
    internalProductId: string,
    ids: readonly string[],
  ): Promise<ListingSaleHold[]> {
    if (ids.length === 0) return [];
    const rows = await this.ormRepository.find({
      where: { internalProductId, id: In([...ids]) },
    });
    return rows.map((row) => this.toDomain(row));
  }

  async release(ids: readonly string[], releasedBy: string, releasedAt: Date): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await this.ormRepository.update(
      { id: In([...ids]), releasedAt: IsNull() },
      { releasedAt, releasedBy },
    );
    return result.affected ?? 0;
  }

  async countProductsNeedingAttention(): Promise<number> {
    const rows = (await this.ormRepository.query(
      `SELECT COUNT(DISTINCT "internalProductId")::text AS count
         FROM "listing_sale_holds"
        WHERE "releasedAt" IS NULL AND "outcome" <> 'applied'`,
    )) as { count: string }[];
    return Number(rows[0]?.count ?? 0);
  }

  private toDomain(row: ListingSaleHoldOrmEntity): ListingSaleHold {
    return new ListingSaleHold({
      id: row.id,
      connectionId: row.connectionId,
      entityType: row.entityType,
      externalId: row.externalId,
      externalParentId: row.externalParentId,
      internalProductId: row.internalProductId,
      internalVariantId: row.internalVariantId,
      method: row.method,
      outcome: row.outcome,
      outcomeReason: row.outcomeReason,
      staleAt: new Date(row.staleAt),
      appliedAt: new Date(row.appliedAt),
      releasedAt: row.releasedAt ? new Date(row.releasedAt) : null,
      releasedBy: row.releasedBy,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    });
  }
}
