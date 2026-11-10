/**
 * Promotion Application Log Repository (#3935)
 *
 * Implements {@link PromotionApplicationLogPort}: an append-only table plus a
 * narrow dismissal write.
 *
 * @module libs/core/src/promotions/infrastructure/persistence/repositories
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type {
  AppendPromotionApplication,
  PromotionApplicationLogPort,
} from '../../../domain/ports/promotion-application-log.port';
import {
  PromotionApplicationOutcomeValues,
  type PromotionApplicationOutcome,
  type PromotionApplicationRecord,
} from '../../../domain/types/promotion-application.types';
import { PromotionApplicationOrmEntity } from '../entities/promotion-application.orm-entity';

function toOutcome(value: string): PromotionApplicationOutcome {
  return (PromotionApplicationOutcomeValues as readonly string[]).includes(value)
    ? (value as PromotionApplicationOutcome)
    : 'failed';
}

@Injectable()
export class PromotionApplicationLogRepository implements PromotionApplicationLogPort {
  constructor(
    @InjectRepository(PromotionApplicationOrmEntity)
    private readonly orm: Repository<PromotionApplicationOrmEntity>,
  ) {}

  async append(entries: readonly AppendPromotionApplication[]): Promise<void> {
    if (entries.length === 0) return;
    await this.orm.insert(entries.map((entry) => ({ ...entry })));
  }

  async findByOrder(internalOrderId: string, limit: number): Promise<PromotionApplicationRecord[]> {
    const rows = await this.orm.find({
      where: { internalOrderId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
    return rows.map((row) => this.toDomain(row));
  }

  async findByPromotion(promotionId: string, limit: number): Promise<PromotionApplicationRecord[]> {
    const rows = await this.orm.find({
      where: { promotionId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
    return rows.map((row) => this.toDomain(row));
  }

  async findById(id: string): Promise<PromotionApplicationRecord | null> {
    const row = await this.orm.findOne({ where: { id } });
    return row === null ? null : this.toDomain(row);
  }

  async findOrderIdsNeedingAttention(limit: number): Promise<string[]> {
    const rows: { internalOrderId: string }[] = await this.orm.query(
      `SELECT DISTINCT latest."internalOrderId"
         FROM (
           SELECT DISTINCT ON ("internalOrderId", "promotionId")
                  "internalOrderId", outcome, reason, "dismissedAt"
             FROM promotion_applications
            ORDER BY "internalOrderId", "promotionId", "createdAt" DESC
         ) latest
        WHERE latest.outcome <> 'applied'
          AND latest."dismissedAt" IS NULL
          AND (latest.outcome = 'failed'
               OR latest.reason IS NULL
               OR latest.reason NOT IN (
                 'customer-limit-reached', 'customer-unknown',
                 'below-per-unit-threshold', 'superseded-by-earlier-rule',
                 'gift-already-in-order'))
        LIMIT $1`,
      [limit],
    );
    return rows.map((row) => row.internalOrderId);
  }

  async dismiss(id: string, userId: string, at: Date): Promise<PromotionApplicationRecord | null> {
    await this.orm.update({ id }, { dismissedAt: at, dismissedByUserId: userId });
    return this.findById(id);
  }

  private toDomain(row: PromotionApplicationOrmEntity): PromotionApplicationRecord {
    return {
      id: row.id,
      promotionId: row.promotionId,
      promotionName: row.promotionName,
      internalOrderId: row.internalOrderId,
      outcome: toOutcome(row.outcome),
      reason: row.reason,
      quantity: row.quantity,
      message: row.message,
      dismissedAt: row.dismissedAt,
      dismissedByUserId: row.dismissedByUserId,
      createdAt: row.createdAt,
    };
  }
}
