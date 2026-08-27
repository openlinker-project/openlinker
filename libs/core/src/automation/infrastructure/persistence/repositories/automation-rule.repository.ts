/**
 * Automation Rule Repository (#2358)
 *
 * TypeORM implementation of `AutomationRuleRepositoryPort`. ORM↔domain mapping
 * is private here (engineering-standards § ORM ↔ Domain Mapping); application
 * services never see an ORM entity.
 *
 * **A malformed persisted member is DROPPED, not thrown.** `toDomain` filters
 * `conditions` and `actions` through their narrowers, so one bad row cannot
 * crash every read of the rule carrying it — the #2170 "malformed row never
 * matches" contract. The write path is deliberately the opposite: the service
 * refuses a malformed member loudly, because there an operator is present.
 *
 * A consequence worth naming: a rule whose actions were ALL dropped reads back
 * with an empty `actions` array, which the service's 1..3 cap would refuse on
 * the way in. That is the honest representation — the rule can do nothing — and
 * it is why the evaluator (#2359) must treat an empty action list as
 * non-firing rather than assuming the cap held.
 *
 * `QueryFailedError` 23505 on the unique index becomes the domain
 * `AutomationRuleConflictError` — infrastructure errors never escape the port.
 *
 * @module libs/core/src/automation/infrastructure/persistence/repositories
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, QueryFailedError, Repository } from 'typeorm';
import { Logger } from '@openlinker/shared/logging';

import type {
  AutomationRulePersistInput,
  AutomationRuleRepositoryPort,
} from '../../../domain/ports/automation-rule-repository.port';
import { AutomationRule } from '../../../domain/entities/automation-rule.entity';
import type {
  AutomationTrigger} from '../../../domain/types/automation-trigger.types';
import {
  isAutomationTrigger,
} from '../../../domain/types/automation-trigger.types';
import { isAutomationCondition } from '../../../domain/types/automation-condition.types';
import type {
  AutomationTriggerConfig} from '../../../domain/types/automation-trigger-config.types';
import {
  isAutomationTriggerConfig,
} from '../../../domain/types/automation-trigger-config.types';
import { isAutomationAction } from '../../../domain/types/automation-action.types';
import { AutomationRuleConflictError } from '../../../domain/exceptions/automation-rule-conflict.error';
import { AutomationRuleNotFoundError } from '../../../domain/exceptions/automation-rule-not-found.error';
import { AutomationRuleOrmEntity } from '../entities/automation-rule.orm-entity';

const UNIQUE_VIOLATION_CODE = '23505';
const TRIGGER_HASH_FROM_CONSTRAINT = 'UQ_automation_rules_trigger_hash_from';

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

@Injectable()
export class AutomationRuleRepository implements AutomationRuleRepositoryPort {
  private readonly logger = new Logger(AutomationRuleRepository.name);

  constructor(
    @InjectRepository(AutomationRuleOrmEntity)
    private readonly ormRepository: Repository<AutomationRuleOrmEntity>,
  ) {}

  async findById(id: string): Promise<AutomationRule | null> {
    const entity = await this.ormRepository.findOne({ where: { id } });
    return entity ? this.toDomain(entity) : null;
  }

  async findByTrigger(trigger: AutomationTrigger): Promise<AutomationRule[]> {
    const entities = await this.ormRepository.find({
      where: { trigger },
      order: { createdAt: 'ASC' },
    });
    return entities.map((entity) => this.toDomain(entity));
  }

  async findActiveByTrigger(trigger: AutomationTrigger, on: Date): Promise<AutomationRule[]> {
    const onDate = toDateOnly(on);
    const entities = await this.ormRepository.find({
      where: { trigger, isActive: true, effectiveFrom: LessThanOrEqual(onDate) },
      order: { createdAt: 'ASC' },
    });
    // The open-ended `effectiveTo IS NULL` arm cannot be expressed alongside
    // `LessThanOrEqual` in one `where` object without a second OR branch, and a
    // two-branch `where` array would duplicate every other predicate. Filtering
    // the upper bound in memory is safe because the query is already narrowed
    // to one trigger's ACTIVE rules — a set bounded by how many automations an
    // operator authored, not by table size.
    return entities
      .filter((entity) => entity.effectiveTo === null || entity.effectiveTo >= onDate)
      .map((entity) => this.toDomain(entity));
  }

  async findByTriggerAndDefinitionHash(
    trigger: AutomationTrigger,
    definitionHash: string,
  ): Promise<AutomationRule[]> {
    const entities = await this.ormRepository.find({ where: { trigger, definitionHash } });
    return entities.map((entity) => this.toDomain(entity));
  }

  async countRulesByTrigger(): Promise<Map<AutomationTrigger, number>> {
    const rows = await this.ormRepository
      .createQueryBuilder('rule')
      .select('rule.trigger', 'trigger')
      .addSelect('COUNT(*)', 'count')
      .groupBy('rule.trigger')
      .getRawMany<{ trigger: string; count: string }>();

    const counts = new Map<AutomationTrigger, number>();
    for (const row of rows) {
      // A row whose trigger this build does not recognise is skipped rather
      // than counted under a guessed key — the same coerce-on-read rule the
      // narrowers apply everywhere else in this context. Logged, because a
      // count that silently omits rows is indistinguishable from a correct one.
      if (isAutomationTrigger(row.trigger)) {
        counts.set(row.trigger, Number(row.count));
      } else {
        this.logger.warn(
          `Skipping ${row.count} automation rule(s) with unrecognised trigger "${row.trigger}" while counting.`,
        );
      }
    }
    return counts;
  }

  async create(input: AutomationRulePersistInput): Promise<AutomationRule> {
    const entity = this.ormRepository.create(this.toOrm(input));
    return this.saveTranslatingConflict(entity, input);
  }

  async update(id: string, input: AutomationRulePersistInput): Promise<AutomationRule> {
    const existing = await this.ormRepository.findOne({ where: { id } });
    if (existing === null) throw new AutomationRuleNotFoundError(id);

    // Merge rather than construct, so `moneyAckByUserId` / `moneyAckAt` — which
    // the write input does not carry (they are #2363's own write) — survive an
    // ordinary rule edit instead of being silently nulled.
    const merged = this.ormRepository.merge(existing, this.toOrm(input));
    return this.saveTranslatingConflict(merged, input);
  }

  async delete(id: string): Promise<void> {
    await this.ormRepository.delete({ id });
  }

  async setMoneyAck(
    id: string,
    byUserId: string | null,
    at: Date | null,
  ): Promise<AutomationRule> {
    // A targeted UPDATE rather than a load-merge-save: nothing else on the row is
    // being written, and a merge would re-serialise the jsonb columns — which
    // read back through the DROPPING narrowers, so a rule carrying one malformed
    // persisted condition would silently lose it on an unrelated acknowledgement.
    await this.ormRepository.update({ id }, { moneyAckByUserId: byUserId, moneyAckAt: at });
    const updated = await this.ormRepository.findOne({ where: { id } });
    if (updated === null) throw new AutomationRuleNotFoundError(id);
    return this.toDomain(updated);
  }

  private async saveTranslatingConflict(
    entity: AutomationRuleOrmEntity,
    input: AutomationRulePersistInput,
  ): Promise<AutomationRule> {
    try {
      const saved = await this.ormRepository.save(entity);
      return this.toDomain(saved);
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error as QueryFailedError & { code?: string }).code === UNIQUE_VIOLATION_CODE &&
        error.message.includes(TRIGGER_HASH_FROM_CONSTRAINT)
      ) {
        const candidates = await this.findByTriggerAndDefinitionHash(
          input.trigger,
          input.definitionHash,
        );
        const conflicting = candidates.find(
          (rule) => toDateOnly(rule.effectiveFrom) === toDateOnly(input.effectiveFrom),
        );
        throw new AutomationRuleConflictError(
          input.trigger,
          input.definitionHash,
          conflicting?.id ?? null,
        );
      }
      throw error;
    }
  }

  private toOrm(input: AutomationRulePersistInput): Partial<AutomationRuleOrmEntity> {
    return {
      name: input.name,
      trigger: input.trigger,
      triggerConfig: input.triggerConfig as Record<string, unknown>,
      conditions: [...input.conditions],
      actions: [...input.actions],
      definitionHash: input.definitionHash,
      isActive: input.isActive,
      effectiveFrom: toDateOnly(input.effectiveFrom),
      effectiveTo: input.effectiveTo ? toDateOnly(input.effectiveTo) : null,
    };
  }

  private toDomain(entity: AutomationRuleOrmEntity): AutomationRule {
    const rawConditions = Array.isArray(entity.conditions) ? entity.conditions : [];
    const rawActions = Array.isArray(entity.actions) ? entity.actions : [];
    // Same coerce-on-read contract as the conditions/actions filters: a
    // `triggerConfig` that does not narrow for its own trigger degrades to
    // `{}` rather than throwing. For the two `deadline-sweep` triggers that
    // means the rule reads back with NO threshold, which the sweep must treat
    // as non-firing — the safe direction. It cannot silently become a
    // different threshold.
    const triggerRecognised = isAutomationTrigger(entity.trigger);
    const trigger = entity.trigger as AutomationTrigger;
    const triggerConfig: AutomationTriggerConfig =
      triggerRecognised && isAutomationTriggerConfig(trigger, entity.triggerConfig)
        ? entity.triggerConfig
        : {};

    // An unrecognised trigger is CARRIED, not dropped — deleting an operator's
    // rule from a read because this build does not know its trigger would hide
    // the row from the very surface that could fix it. But it is not silent:
    // the cast above is the one place in this context where the declared type
    // outruns what the row proves, and #2359's evaluator switches on this value
    // with a `never` default, so an unrecognised member reaches a branch that
    // asserts it cannot exist. The warn is what makes that diagnosable.
    if (!triggerRecognised) {
      this.logger.warn(
        `Automation rule ${entity.id} carries unrecognised trigger "${entity.trigger}"; ` +
          `it will not match until this build understands that trigger.`,
      );
    }

    return new AutomationRule(
      entity.id,
      entity.name,
      // A trigger this build does not recognise is carried through rather than
      // dropped — the row exists and an operator can see it — and is narrowed
      // again at the evaluator boundary (#2359), which must treat an
      // unrecognised trigger as non-matching.
      trigger,
      triggerConfig,
      rawConditions.filter(isAutomationCondition),
      rawActions.filter(isAutomationAction),
      entity.definitionHash,
      entity.isActive,
      new Date(entity.effectiveFrom),
      entity.effectiveTo ? new Date(entity.effectiveTo) : null,
      entity.moneyAckByUserId,
      entity.moneyAckAt,
      entity.createdAt,
      entity.updatedAt,
    );
  }
}
