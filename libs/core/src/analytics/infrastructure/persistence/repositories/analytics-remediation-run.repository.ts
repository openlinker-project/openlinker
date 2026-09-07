/**
 * Analytics Remediation Run Repository
 *
 * TypeORM-backed implementation of
 * `AnalyticsRemediationRunRepositoryPort` (#2468). ORM ↔ domain mapping is
 * private to this class, mirroring the sibling
 * `AnalyticsDisplaySettingsRepository`.
 *
 * Two behaviours are deliberate rather than incidental:
 *
 *  - **`createRun` is insert-then-translate, not read-then-insert.** The
 *    partial unique index (`WHERE status IN ('open','in-progress')`) is the
 *    authority on "this category already has a run in flight"; a preceding
 *    `findOpenByCategory` would let two concurrent requests both observe
 *    nothing and both start a repair. The unique violation is translated to
 *    the domain `OpenRemediationRunExistsError`, matching
 *    `IdentifierMappingRepository.insertMapping`'s precedent.
 *  - **`transitionIfOpen` is a conditional UPDATE and reports whether it
 *    won.** `affected > 0` is the answer, the same shape
 *    `OrderRecordRepository.stampFxIfAbsent` and
 *    `ShipmentRepository.claimWaybillRelay` use, so a re-delivered driver job
 *    cannot re-decide a run another worker already terminalised.
 *
 * @module libs/core/src/analytics/infrastructure/persistence/repositories
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, QueryFailedError, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import {
  CoverageResolutionStatusValues,
  type CoverageResolutionStatus,
} from '@openlinker/core/orders/types';
import { AnalyticsRemediationRun } from '../../../domain/entities/analytics-remediation-run.entity';
import { OpenRemediationRunExistsError } from '../../../domain/exceptions/open-remediation-run-exists.error';
import type { AnalyticsRemediationRunRepositoryPort } from '../../../domain/ports/analytics-remediation-run-repository.port';
import {
  ANALYTICS_REMEDIATION_RUN_ID_PREFIX,
  OPEN_REMEDIATION_RUN_STATUSES,
  type AnalyticsRemediationRunInput,
} from '../../../domain/types/analytics-remediation-run.types';
import { AnalyticsRemediationRunOrmEntity } from '../entities/analytics-remediation-run.orm-entity';

const isCoverageResolutionStatus = (value: string): value is CoverageResolutionStatus =>
  (CoverageResolutionStatusValues as readonly string[]).includes(value);

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof QueryFailedError &&
  (error.message.includes('duplicate key') ||
    (error as QueryFailedError & { code?: string }).code === '23505');

@Injectable()
export class AnalyticsRemediationRunRepository implements AnalyticsRemediationRunRepositoryPort {
  constructor(
    @InjectRepository(AnalyticsRemediationRunOrmEntity)
    private readonly ormRepository: Repository<AnalyticsRemediationRunOrmEntity>
  ) {}

  async createRun(
    input: AnalyticsRemediationRunInput,
    status: CoverageResolutionStatus
  ): Promise<AnalyticsRemediationRun> {
    const entity = this.ormRepository.create({
      id: `${ANALYTICS_REMEDIATION_RUN_ID_PREFIX}${randomUUID().replace(/-/g, '')}`,
      category: input.category,
      status,
      detail: null,
      affectedCount: input.affectedCount,
      triggeredByUserId: input.triggeredByUserId,
    });

    try {
      const saved = await this.ormRepository.save(entity);
      return this.toDomain(saved);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new OpenRemediationRunExistsError(input.category);
      }
      throw error;
    }
  }

  async findById(id: string): Promise<AnalyticsRemediationRun | null> {
    const row = await this.ormRepository.findOne({ where: { id } });
    return row ? this.toDomain(row) : null;
  }

  async findOpenByCategory(category: string): Promise<AnalyticsRemediationRun | null> {
    const row = await this.ormRepository.findOne({
      where: { category, status: In([...OPEN_REMEDIATION_RUN_STATUSES]) },
      order: { createdAt: 'DESC' },
    });
    return row ? this.toDomain(row) : null;
  }

  async transitionIfOpen(
    id: string,
    status: CoverageResolutionStatus,
    detail: string | null
  ): Promise<boolean> {
    const result = await this.ormRepository
      .createQueryBuilder()
      .update(AnalyticsRemediationRunOrmEntity)
      .set({ status, detail, updatedAt: new Date() })
      .where('id = :id', { id })
      .andWhere('status IN (:...openStatuses)', {
        openStatuses: [...OPEN_REMEDIATION_RUN_STATUSES],
      })
      .execute();

    return (result.affected ?? 0) > 0;
  }

  private toDomain(entity: AnalyticsRemediationRunOrmEntity): AnalyticsRemediationRun {
    if (!isCoverageResolutionStatus(entity.status)) {
      // Defensive, and loud on purpose: a run whose lifecycle value this build
      // cannot represent must not be coerced into one the operator would then
      // act on. Same posture as `AnalyticsDisplaySettingsRepository.toDomain`.
      throw new Error(
        `analytics_remediation_runs.status has an unknown value '${entity.status}' (run ${entity.id})`
      );
    }
    return new AnalyticsRemediationRun(
      entity.id,
      entity.category,
      entity.status,
      entity.detail,
      // `integer` round-trips as a number, but a driver/column-type change
      // would silently hand back a string that then string-concatenates in
      // every arithmetic consumer.
      Number(entity.affectedCount),
      entity.triggeredByUserId,
      entity.createdAt,
      entity.updatedAt
    );
  }
}
