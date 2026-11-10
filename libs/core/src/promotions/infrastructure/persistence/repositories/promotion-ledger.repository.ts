/**
 * Promotion Ledger Repository (#3935)
 *
 * Implements {@link PromotionLedgerPort} over the state and grant tables. The
 * grant write is a conditional insert and the state writes are narrow upserts:
 * nothing reads a value and then decides on it in application code, because two
 * ingestions can race on one promotion.
 *
 * @module libs/core/src/promotions/infrastructure/persistence/repositories
 */
import { AsyncLocalStorage } from 'node:async_hooks';

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, type EntityManager } from 'typeorm';

import type { PromotionLedgerPort } from '../../../domain/ports/promotion-ledger.port';
import {
  isPromotionPauseReason,
  type PromotionGrant,
  type PromotionPauseReason,
  type PromotionState,
} from '../../../domain/types/promotion-application.types';
import { PromotionGrantOrmEntity } from '../entities/promotion-grant.orm-entity';
import { PromotionStateOrmEntity } from '../entities/promotion-state.orm-entity';

@Injectable()
export class PromotionLedgerRepository implements PromotionLedgerPort {
  /**
   * The transaction `withPromotionsLocked` opened, so every ledger read and write
   * inside `work` runs on that one connection: the grant and the state change
   * commit together, and the lock is not held by one connection while a second
   * one does the writing.
   */
  private readonly lockedTransaction = new AsyncLocalStorage<EntityManager>();

  constructor(
    @InjectRepository(PromotionGrantOrmEntity)
    private readonly grantsRepo: Repository<PromotionGrantOrmEntity>,
  ) {}

  private get manager(): EntityManager {
    return this.lockedTransaction.getStore() ?? this.grantsRepo.manager;
  }

  private get states(): Repository<PromotionStateOrmEntity> {
    return this.manager.getRepository(PromotionStateOrmEntity);
  }

  private get grants(): Repository<PromotionGrantOrmEntity> {
    return this.manager.getRepository(PromotionGrantOrmEntity);
  }

  async withPromotionsLocked<T>(
    promotionIds: readonly string[],
    work: () => Promise<T>,
  ): Promise<T> {
    const keys = [...new Set(promotionIds)].sort();
    if (keys.length === 0) return work();
    // A nested call reuses the open transaction (its locks are already held).
    if (this.lockedTransaction.getStore() !== undefined) return work();
    return this.grantsRepo.manager.transaction(async (manager) => {
      for (const key of keys) {
        await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`promotion:${key}`]);
      }
      return this.lockedTransaction.run(manager, work);
    });
  }

  async findStates(promotionIds: readonly string[]): Promise<Map<string, PromotionState>> {
    if (promotionIds.length === 0) return new Map();
    const rows = await this.states.find({ where: { promotionId: In([...promotionIds]) } });
    return new Map(
      rows.map((row) => [
        row.promotionId,
        {
          promotionId: row.promotionId,
          // An unrecognised reason reads as "not paused" rather than as a pause
          // this build cannot explain or lift.
          pausedReason: isPromotionPauseReason(row.pausedReason) ? row.pausedReason : null,
          pausedAt: row.pausedAt,
          capExtension: row.capExtension,
        },
      ]),
    );
  }

  async sumUnitsGiven(promotionIds: readonly string[]): Promise<Map<string, number>> {
    if (promotionIds.length === 0) return new Map();
    const rows = await this.grants
      .createQueryBuilder('g')
      .select('g."promotionId"', 'promotionId')
      .addSelect('COALESCE(SUM(g."quantity"), 0)', 'units')
      .where('g."promotionId" IN (:...promotionIds)', { promotionIds: [...promotionIds] })
      .groupBy('g."promotionId"')
      .getRawMany<{ promotionId: string; units: string }>();
    return new Map(rows.map((row) => [row.promotionId, Number(row.units)]));
  }

  async sumUnitsForCustomer(
    promotionIds: readonly string[],
    customerId: string,
  ): Promise<Map<string, number>> {
    if (promotionIds.length === 0) return new Map();
    const rows = await this.grants
      .createQueryBuilder('g')
      .select('g."promotionId"', 'promotionId')
      .addSelect('COALESCE(SUM(g."quantity"), 0)', 'units')
      .where('g."promotionId" IN (:...promotionIds)', { promotionIds: [...promotionIds] })
      .andWhere('g."customerId" = :customerId', { customerId })
      .groupBy('g."promotionId"')
      .getRawMany<{ promotionId: string; units: string }>();
    return new Map(rows.map((row) => [row.promotionId, Number(row.units)]));
  }

  async findGrantsForOrder(internalOrderId: string): Promise<PromotionGrant[]> {
    const rows = await this.grants.find({ where: { internalOrderId } });
    return rows.map((row) => ({
      promotionId: row.promotionId,
      internalOrderId: row.internalOrderId,
      customerId: row.customerId,
      quantity: row.quantity,
      productId: row.productId,
      variantId: row.variantId,
      documentForm: row.documentForm,
      createdAt: row.createdAt,
    }));
  }

  async releaseGrantsForOrder(internalOrderId: string): Promise<number> {
    const result = await this.grants.delete({ internalOrderId });
    return result.affected ?? 0;
  }

  async sumPendingUnitsForVariants(
    variantIds: readonly string[],
    excludeOrderId: string | null,
    notOlderThan: Date,
  ): Promise<Map<string, number>> {
    if (variantIds.length === 0) return new Map();
    // "Granted, not yet held": the order has no held reservation row yet, so the
    // availability read does not subtract its gift. The age bound keeps a grant
    // whose order never reserved from holding stock back for ever.
    const rows: Array<{ variantId: string; units: string }> = await this.manager.query(
      `SELECT g."variantId" AS "variantId", COALESCE(SUM(g."quantity"), 0) AS units
         FROM "promotion_grants" g
        WHERE g."variantId" = ANY($1::text[])
          AND g."createdAt" > $2
          AND ($3::text IS NULL OR g."internalOrderId" <> $3)
          AND NOT EXISTS (
            SELECT 1 FROM "reservations" r
             WHERE r."orderRecordId" = g."internalOrderId" AND r."status" = 'held')
        GROUP BY g."variantId"`,
      [[...variantIds], notOlderThan, excludeOrderId],
    );
    return new Map(rows.map((row) => [row.variantId, Number(row.units)]));
  }

  async recordGrant(grant: Omit<PromotionGrant, 'createdAt'>): Promise<boolean> {
    const result = await this.grants
      .createQueryBuilder()
      .insert()
      .values({
        promotionId: grant.promotionId,
        internalOrderId: grant.internalOrderId,
        customerId: grant.customerId,
        quantity: grant.quantity,
        productId: grant.productId,
        variantId: grant.variantId,
        documentForm: grant.documentForm,
      })
      .orIgnore()
      .returning('id')
      .execute();
    return Array.isArray(result.raw) && result.raw.length > 0;
  }

  async setPause(promotionId: string, reason: PromotionPauseReason | null): Promise<void> {
    await this.states.query(
      `INSERT INTO "promotion_state" ("promotionId", "pausedReason", "pausedAt", "capExtension", "updatedAt")
       VALUES ($1, $2::varchar, CASE WHEN $2::varchar IS NULL THEN NULL ELSE now() END, 0, now())
       ON CONFLICT ("promotionId") DO UPDATE
         SET "pausedReason" = EXCLUDED."pausedReason",
             "pausedAt" = CASE
               WHEN EXCLUDED."pausedReason" IS NULL THEN NULL
               WHEN "promotion_state"."pausedReason" IS NOT DISTINCT FROM EXCLUDED."pausedReason"
                 THEN "promotion_state"."pausedAt"
               ELSE now() END,
             "updatedAt" = now()`,
      [promotionId, reason],
    );
  }

  async extendCap(promotionId: string, extraUnits: number): Promise<void> {
    await this.states.query(
      `INSERT INTO "promotion_state" ("promotionId", "pausedReason", "pausedAt", "capExtension", "updatedAt")
       VALUES ($1, NULL, NULL, $2::int, now())
       ON CONFLICT ("promotionId") DO UPDATE
         SET "capExtension" = "promotion_state"."capExtension" + $2::int,
             "pausedReason" = CASE WHEN "promotion_state"."pausedReason" = 'unit-cap'
                                   THEN NULL ELSE "promotion_state"."pausedReason" END,
             "pausedAt" = CASE WHEN "promotion_state"."pausedReason" = 'unit-cap'
                               THEN NULL ELSE "promotion_state"."pausedAt" END,
             "updatedAt" = now()`,
      [promotionId, extraUnits],
    );
  }
}
