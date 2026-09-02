/**
 * Automation Trigger Firing Repository (#2360)
 *
 * `INSERT ... ON CONFLICT DO NOTHING` against
 * `UQ_automation_trigger_firings_rule_subject`, reporting `affected > 0` as the
 * answer to "did I win?".
 *
 * **The emitted SQL is a bare `ON CONFLICT DO NOTHING`, deliberately and
 * knowingly.** TypeORM 0.3.17's `orIgnore(statement)` DISCARDS its argument
 * (`onIgnore = !!statement`) and always emits the bare form, so a "named
 * conflict target" here would be prose describing SQL that is not generated.
 * A named target is also not expressible without the deprecated `onConflict`,
 * and `ON CONFLICT ON CONSTRAINT` would not work regardless: #2358 declares the
 * uniqueness with `@Index(..., { unique: true })`, which emits a unique INDEX
 * rather than a table CONSTRAINT, and Postgres accepts only the latter there.
 *
 * The bare form is safe **only because this table has exactly one unique index
 * plus a primary key on a generated uuid**, so the only conflict reachable in
 * practice is the one being tested for. If a second unique constraint is ever
 * added, this must become an explicit column-list target first — otherwise an
 * unrelated conflict would silently report "already fired", and "already fired"
 * is the answer that suppresses a dispatch forever.
 *
 * @module libs/core/src/automation/infrastructure/persistence/repositories
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type {
  AutomationTriggerFiringClaim,
  AutomationTriggerFiringRepositoryPort,
} from '../../../domain/ports/automation-trigger-firing-repository.port';
import { AutomationTriggerFiringOrmEntity } from '../entities/automation-trigger-firing.orm-entity';

@Injectable()
export class AutomationTriggerFiringRepository implements AutomationTriggerFiringRepositoryPort {
  constructor(
    @InjectRepository(AutomationTriggerFiringOrmEntity)
    private readonly repository: Repository<AutomationTriggerFiringOrmEntity>,
  ) {}

  async claim(input: AutomationTriggerFiringClaim): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .insert()
      .into(AutomationTriggerFiringOrmEntity)
      .values({
        ruleId: input.ruleId,
        subjectKind: input.subjectKind,
        subjectId: input.subjectId,
        firedAt: input.firedAt,
      })
      .orIgnore()
      .execute();

    return (result.raw as unknown[]).length > 0;
  }
}
