/**
 * Promotion Repository (#3935)
 *
 * Implements {@link PromotionRepositoryPort}. Definitions read back through the
 * dropping narrowers: a malformed persisted condition is filtered to "never
 * matches" and a malformed benefit drops the whole row (a promotion that cannot
 * say what it gives must not give anything), so one bad row never crashes a read.
 *
 * @module libs/core/src/promotions/infrastructure/persistence/repositories
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { Logger } from '@openlinker/shared/logging';

import { Promotion } from '../../../domain/entities/promotion.entity';
import {
  PromotionConflictError,
  PromotionNotFoundError,
} from '../../../domain/exceptions/promotion.errors';
import type {
  PromotionPersistInput,
  PromotionRepositoryPort,
} from '../../../domain/ports/promotion-repository.port';
import { isPromotionBenefit } from '../../../domain/types/promotion-benefit.types';
import { isPromotionCondition } from '../../../domain/types/promotion-condition.types';
import { PromotionOrmEntity } from '../entities/promotion.orm-entity';

const UNIQUE_VIOLATION_CODE = '23505';
const HASH_FROM_CONSTRAINT = 'UQ_promotions_hash_from';

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

@Injectable()
export class PromotionRepository implements PromotionRepositoryPort {
  private readonly logger = new Logger(PromotionRepository.name);

  constructor(
    @InjectRepository(PromotionOrmEntity)
    private readonly orm: Repository<PromotionOrmEntity>,
  ) {}

  async findById(id: string): Promise<Promotion | null> {
    const entity = await this.orm.findOne({ where: { id } });
    return entity === null ? null : this.toDomain(entity);
  }

  async findAllOrdered(): Promise<Promotion[]> {
    const rows = await this.orm.find({ order: { position: 'ASC', createdAt: 'ASC' } });
    return rows.flatMap((row) => {
      const promotion = this.toDomain(row);
      return promotion === null ? [] : [promotion];
    });
  }

  async findByDefinitionHash(definitionHash: string): Promise<Promotion[]> {
    const rows = await this.orm.find({ where: { definitionHash } });
    return rows.flatMap((row) => {
      const promotion = this.toDomain(row);
      return promotion === null ? [] : [promotion];
    });
  }

  async create(input: PromotionPersistInput): Promise<Promotion> {
    const [{ next }] = (await this.orm.query(
      `SELECT COALESCE(MAX("position"), 0) + 1 AS next FROM "promotions"`,
    )) as Array<{ next: string }>;
    const entity = this.orm.create({ ...this.toOrm(input), position: Number(next) });
    return this.saveTranslatingConflict(entity, input);
  }

  async update(id: string, input: PromotionPersistInput): Promise<Promotion> {
    const existing = await this.orm.findOne({ where: { id } });
    if (existing === null) throw new PromotionNotFoundError(id);
    const merged = this.orm.merge(existing, this.toOrm(input));
    return this.saveTranslatingConflict(merged, input);
  }

  async delete(id: string): Promise<void> {
    await this.orm.delete({ id });
  }

  async setPositions(orderedIds: readonly string[]): Promise<void> {
    if (orderedIds.length === 0) return;
    // One statement, so a reorder is never half applied.
    await this.orm.query(
      `UPDATE "promotions" AS p
          SET "position" = v.pos
         FROM (SELECT unnest($1::uuid[]) AS id, generate_series(1, $2::int) AS pos) AS v
        WHERE p."id" = v.id`,
      [[...orderedIds], orderedIds.length],
    );
  }

  private async saveTranslatingConflict(
    entity: PromotionOrmEntity,
    input: PromotionPersistInput,
  ): Promise<Promotion> {
    try {
      const saved = await this.orm.save(entity);
      const promotion = this.toDomain(saved);
      if (promotion === null) throw new Error(`Promotion ${saved.id} did not read back`);
      return promotion;
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error as QueryFailedError & { code?: string }).code === UNIQUE_VIOLATION_CODE &&
        error.message.includes(HASH_FROM_CONSTRAINT)
      ) {
        const candidates = await this.findByDefinitionHash(input.definitionHash);
        const conflicting = candidates.find(
          (p) => toDateOnly(p.effectiveFrom) === toDateOnly(input.effectiveFrom),
        );
        throw new PromotionConflictError(input.definitionHash, conflicting?.id ?? null);
      }
      throw error;
    }
  }

  private toOrm(input: PromotionPersistInput): Partial<PromotionOrmEntity> {
    return {
      name: input.name,
      isActive: input.isActive,
      effectiveFrom: toDateOnly(input.effectiveFrom),
      effectiveTo: input.effectiveTo === null ? null : toDateOnly(input.effectiveTo),
      conditions: [...input.conditions],
      benefit: input.benefit,
      combinable: input.combinable,
      unitCap: input.limits.unitCap,
      customerLimit: input.limits.customerLimit,
      definitionHash: input.definitionHash,
    };
  }

  private toDomain(entity: PromotionOrmEntity): Promotion | null {
    if (!isPromotionBenefit(entity.benefit)) {
      this.logger.warn(
        `Promotion ${entity.id} carries an unrecognised benefit; it is skipped until this build understands it.`,
      );
      return null;
    }
    const rawConditions: unknown[] = Array.isArray(entity.conditions) ? entity.conditions : [];
    return new Promotion(
      entity.id,
      entity.name,
      entity.isActive,
      entity.position,
      new Date(entity.effectiveFrom),
      entity.effectiveTo === null ? null : new Date(entity.effectiveTo),
      rawConditions.filter(isPromotionCondition),
      entity.benefit,
      entity.combinable,
      { unitCap: entity.unitCap ?? null, customerLimit: entity.customerLimit ?? null },
      entity.definitionHash,
      entity.createdAt,
      entity.updatedAt,
    );
  }
}
