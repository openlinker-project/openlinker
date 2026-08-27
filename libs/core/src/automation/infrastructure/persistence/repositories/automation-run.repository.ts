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
import { Repository } from 'typeorm';
import { Logger } from '@openlinker/shared/logging';

import type { AutomationRunRepositoryPort } from '../../../domain/ports/automation-run-repository.port';
import { AutomationRun } from '../../../domain/entities/automation-run.entity';
import type { AutomationTrigger } from '../../../domain/types/automation-trigger.types';
import type { AutomationRunOutcome } from '../../../domain/types/automation-run.types';
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
