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
import {
  Between,
  LessThanOrEqual,
  MoreThanOrEqual,
  Repository,
  type FindOptionsWhere,
} from 'typeorm';
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
    const where: FindOptionsWhere<AutomationRunOrmEntity> = {};
    if (filters.ruleId !== undefined) where.ruleId = filters.ruleId;
    if (filters.trigger !== undefined) where.trigger = filters.trigger;
    if (filters.outcome !== undefined) where.outcome = filters.outcome;
    if (filters.subjectKind !== undefined) where.subjectKind = filters.subjectKind;
    if (filters.subjectId !== undefined) where.subjectId = filters.subjectId;

    // Both bounds are inclusive. Only one supplied is still a valid window —
    // `Between` would need both, so the one-sided cases use their own operator
    // rather than inventing a bound the operator did not ask for.
    if (filters.from !== undefined && filters.to !== undefined) {
      where.firedAt = Between(filters.from, filters.to);
    } else if (filters.from !== undefined) {
      where.firedAt = MoreThanOrEqual(filters.from);
    } else if (filters.to !== undefined) {
      where.firedAt = LessThanOrEqual(filters.to);
    }

    const entities = await this.ormRepository.find({
      where,
      // `IDX_automation_runs_fired_at`. A second sort key on `id` is deliberately
      // omitted: two runs sharing a `firedAt` to the microsecond would need the
      // same rule to fire twice in one tick, which the dispatcher's sequential
      // loop cannot produce.
      //
      // TRIPWIRE: that reasoning is what makes offset paging stable here. If
      // dispatch is ever parallelised, `skip`/`take` over a non-unique ORDER BY
      // can repeat or drop a row across pages — add `id` as a tie-breaker then.
      order: { firedAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    return entities.map((entity) => this.toDomain(entity));
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
    );
  }
}
