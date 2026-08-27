/**
 * Automation Run Repository (#2363)
 *
 * TypeORM implementation of the read-only `AutomationRunRepositoryPort`.
 * ORM↔domain mapping is private here; the application layer never sees an ORM
 * entity (engineering-standards § ORM ↔ Domain Mapping).
 *
 * **Coerce on read, never throw** — the same contract every other narrower in
 * this context holds. `trigger`, `subjectKind` and `outcome` are persisted as
 * plain `varchar` columns, so a row written by a newer build can carry a value
 * this one does not know. The `trigger` is CAST through (matching
 * `AutomationRuleRepository`, whose docblock explains why a row is never
 * dropped for it), while `subjectKind` and `outcome` fall back to the values
 * that understate rather than overstate: an unrecognised outcome reads
 * `'failed'`, because a run whose result this build cannot interpret is one an
 * operator should look at, and reading it as `'done'` would hide it.
 *
 * @module libs/core/src/automation/infrastructure/persistence/repositories
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository, type SelectQueryBuilder } from 'typeorm';
import { Logger } from '@openlinker/shared/logging';

import type {
  AutomationRunFilters,
  AutomationRunRepositoryPort,
  NewAutomationRun,
} from '../../../domain/ports/automation-run-repository.port';
import { AutomationRun } from '../../../domain/entities/automation-run.entity';
import type { AutomationTrigger } from '../../../domain/types/automation-trigger.types';
import type {
  AutomationRunOutcome,
  AutomationRunSubjectKind,
} from '../../../domain/types/automation-run.types';
import {
  isAutomationRunOutcome,
  isAutomationRunSubjectKind,
} from '../../../domain/types/automation-run.types';
import { AutomationRunOrmEntity } from '../entities/automation-run.orm-entity';

/**
 * What makes a retry SUPERSEDE the failure it retries: it did not fail.
 *
 * One string, two readers (`applyAttentionPredicate`'s correlated `NOT EXISTS`
 * and `findSupersededRunIds`' batched read), because those two answer the same
 * question at different grains and must never answer it differently. `%alias%`
 * is substituted by the caller.
 */
const RETRY_SUCCEEDED_CONDITION = `%alias%."outcome" <> 'failed'`;

@Injectable()
export class AutomationRunRepository implements AutomationRunRepositoryPort {
  private readonly logger = new Logger(AutomationRunRepository.name);

  constructor(
    @InjectRepository(AutomationRunOrmEntity)
    private readonly ormRepository: Repository<AutomationRunOrmEntity>,
  ) {}

  /**
   * Persist one firing.
   *
   * `steps` goes into the existing jsonb column VERBATIM — the same
   * `AutomationStepResult` shape the read path re-narrows and the frontend
   * already parses (#2366). Widened, never forked: a second step shape is how
   * one firing renders differently in the run log and the timeline.
   *
   * `id` and `createdAt` are left to the database (`@PrimaryGeneratedColumn` and
   * the column default) and read back off the saved row, rather than minted
   * here where the clock would be the application's rather than the row's.
   */
  async save(run: NewAutomationRun): Promise<AutomationRun> {
    const entity = this.ormRepository.create({
      ruleId: run.ruleId,
      ruleName: run.ruleName,
      trigger: run.trigger,
      subjectKind: run.subjectKind,
      subjectId: run.subjectId,
      outcome: run.outcome,
      steps: [...run.steps],
      blockedByRuleIds: run.blockedByRuleIds === null ? null : [...run.blockedByRuleIds],
      firedAt: run.firedAt,
      retryOfRunId: run.retryOfRunId ?? null,
    });
    const saved = await this.ormRepository.save(entity);
    return this.toDomain(saved);
  }

  async findRecentBySubject(
    subjectKind: AutomationRunSubjectKind,
    subjectId: string,
    limit: number,
  ): Promise<AutomationRun[]> {
    const entities = await this.ormRepository.find({
      where: { subjectKind, subjectId },
      order: { firedAt: 'DESC' },
      take: limit,
    });
    return entities.map((entity) => this.toDomain(entity));
  }

  async findById(id: string): Promise<AutomationRun | null> {
    const entity = await this.ormRepository.findOne({ where: { id } });
    return entity === null ? null : this.toDomain(entity);
  }

  async findRecent(
    filters: AutomationRunFilters,
    limit: number,
    offset: number,
  ): Promise<AutomationRun[]> {
    const qb = this.ormRepository.createQueryBuilder('run');

    if (filters.ruleId !== undefined) qb.andWhere('run."ruleId" = :ruleId', { ruleId: filters.ruleId });
    if (filters.trigger !== undefined) qb.andWhere('run."trigger" = :trigger', { trigger: filters.trigger });
    if (filters.outcome !== undefined) qb.andWhere('run."outcome" = :outcome', { outcome: filters.outcome });
    if (filters.subjectKind !== undefined) {
      qb.andWhere('run."subjectKind" = :subjectKind', { subjectKind: filters.subjectKind });
    }
    if (filters.subjectId !== undefined) {
      qb.andWhere('run."subjectId" = :subjectId', { subjectId: filters.subjectId });
    }

    // Both bounds are inclusive, and one alone is still a valid window — the
    // absent side is simply not constrained rather than given a bound the
    // operator never asked for.
    if (filters.from !== undefined) qb.andWhere('run."firedAt" >= :from', { from: filters.from });
    if (filters.to !== undefined) qb.andWhere('run."firedAt" <= :to', { to: filters.to });

    // `attentionOnly: false` is treated as absent — see the port.
    if (filters.attentionOnly === true) this.applyAttentionPredicate(qb, 'run');

    const entities = await qb
      // `IDX_automation_runs_fired_at`. A second sort key on `id` is deliberately
      // omitted: two runs sharing a `firedAt` to the microsecond would need the
      // same rule to fire twice in one tick, which the dispatcher's sequential
      // loop cannot produce.
      //
      // TRIPWIRE: that reasoning is what makes offset paging stable here. If
      // dispatch is ever parallelised, `skip`/`take` over a non-unique ORDER BY
      // can repeat or drop a row across pages — add `id` as a tie-breaker then.
      .orderBy('run."firedAt"', 'DESC')
      .take(limit)
      .skip(offset)
      .getMany();
    return entities.map((entity) => this.toDomain(entity));
  }

  async countAttention(): Promise<number> {
    const qb = this.ormRepository.createQueryBuilder('run');
    this.applyAttentionPredicate(qb, 'run');
    return qb.getCount();
  }

  async findSupersededRunIds(runIds: readonly string[]): Promise<Set<string>> {
    if (runIds.length === 0) return new Set();
    const rows = await this.ormRepository
      .createQueryBuilder('retry')
      .select('retry."retryOfRunId"', 'retryOfRunId')
      .where('retry."retryOfRunId" IN (:...runIds)', { runIds: [...runIds] })
      .andWhere(RETRY_SUCCEEDED_CONDITION.replace(/%alias%/g, 'retry'))
      .groupBy('retry."retryOfRunId"')
      .getRawMany<{ retryOfRunId: string }>();
    return new Set(rows.map((row) => row.retryOfRunId));
  }

  async dismiss(id: string, userId: string, now: Date): Promise<AutomationRun | null> {
    // Conditional UPDATE, the `claimWaybillRelay` shape: the first dismisser is
    // the one recorded, and a concurrent second one changes nothing rather than
    // overwriting the attribution.
    await this.ormRepository.update(
      { id, dismissedAt: IsNull() },
      { dismissedAt: now, dismissedByUserId: userId },
    );
    // Re-read unconditionally. The caller cannot tell a fresh claim from an
    // already-dismissed row, deliberately — see the port.
    return this.findById(id);
  }

  /**
   * The ONE expression of "this firing still needs attention".
   *
   * Shared by `findRecent`'s `attentionOnly` filter and by `countAttention`, so
   * a count can never disagree with the rows it claims to count. The
   * single-row half of the same rule is `isAutomationRunAttentionWorthy`; this
   * is its SQL twin, and the two must move together.
   */
  private applyAttentionPredicate(
    qb: SelectQueryBuilder<AutomationRunOrmEntity>,
    alias: string,
  ): void {
    qb.andWhere(`${alias}."outcome" = :attentionOutcome`, { attentionOutcome: 'failed' })
      .andWhere(`${alias}."dismissedAt" IS NULL`)
      .andWhere(
        `NOT EXISTS (SELECT 1 FROM "automation_runs" retry ` +
          `WHERE retry."retryOfRunId" = ${alias}."id" ` +
          `AND ${RETRY_SUCCEEDED_CONDITION.replace(/%alias%/g, 'retry')})`,
      );
  }

  async findRecentByRuleId(ruleId: string, limit: number): Promise<AutomationRun[]> {
    const entities = await this.ormRepository.find({
      where: { ruleId },
      order: { firedAt: 'DESC' },
      take: limit,
    });
    return entities.map((entity) => this.toDomain(entity));
  }

  private toDomain(entity: AutomationRunOrmEntity): AutomationRun {
    const subjectKind = isAutomationRunSubjectKind(entity.subjectKind)
      ? entity.subjectKind
      : 'order';
    let outcome: AutomationRunOutcome;
    if (isAutomationRunOutcome(entity.outcome)) {
      outcome = entity.outcome;
    } else {
      this.logger.warn(
        `Automation run ${entity.id} carries an unrecognised outcome "${entity.outcome}"; ` +
          `reading it as "failed" so it stays visible to an operator.`,
      );
      outcome = 'failed';
    }

    return new AutomationRun(
      entity.id,
      entity.ruleId,
      entity.ruleName,
      // Cast through, per the #2358 read-path rule: an unrecognised trigger must
      // not remove the row from a HISTORY log, whose whole job is to say what
      // happened.
      entity.trigger as AutomationTrigger,
      subjectKind,
      entity.subjectId,
      outcome,
      Array.isArray(entity.steps) ? entity.steps : [],
      Array.isArray(entity.blockedByRuleIds) ? entity.blockedByRuleIds : null,
      entity.firedAt,
      entity.createdAt,
      entity.dismissedAt,
      entity.dismissedByUserId,
      entity.retryOfRunId,
    );
  }
}
