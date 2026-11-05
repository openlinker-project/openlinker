/**
 * Automation Gift Ledger Repository (#3938)
 *
 * Implements {@link GiftRuleLedgerPort} over the two gift tables. The grant write
 * is a conditional insert and the state writes are narrow upserts: nothing reads a
 * value and then decides on it in application code, because two ingestions can
 * race on one rule.
 *
 * @module libs/core/src/automation/infrastructure/persistence/repositories
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import type { GiftRuleLedgerPort } from '../../../domain/ports/gift-rule-ledger.port';
import {
  isGiftRulePauseReason,
  type GiftGrant,
  type GiftRulePauseReason,
  type GiftRuleState,
} from '../../../domain/types/gift-rule.types';
import { AutomationGiftGrantOrmEntity } from '../entities/automation-gift-grant.orm-entity';
import { AutomationGiftRuleStateOrmEntity } from '../entities/automation-gift-rule-state.orm-entity';

@Injectable()
export class AutomationGiftLedgerRepository implements GiftRuleLedgerPort {
  constructor(
    @InjectRepository(AutomationGiftRuleStateOrmEntity)
    private readonly states: Repository<AutomationGiftRuleStateOrmEntity>,
    @InjectRepository(AutomationGiftGrantOrmEntity)
    private readonly grants: Repository<AutomationGiftGrantOrmEntity>,
  ) {}

  async withRulesLocked<T>(ruleIds: readonly string[], work: () => Promise<T>): Promise<T> {
    const keys = [...new Set(ruleIds)].sort();
    if (keys.length === 0) return work();
    return this.grants.manager.transaction(async (manager) => {
      for (const key of keys) {
        await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`gift_rule:${key}`]);
      }
      return work();
    });
  }

  async findStates(ruleIds: readonly string[]): Promise<Map<string, GiftRuleState>> {
    if (ruleIds.length === 0) return new Map();
    const rows = await this.states.find({ where: { ruleId: In([...ruleIds]) } });
    return new Map(
      rows.map((row) => [
        row.ruleId,
        {
          ruleId: row.ruleId,
          // An unrecognised reason reads as "not paused" rather than as a pause
          // this build cannot explain or lift.
          pausedReason: isGiftRulePauseReason(row.pausedReason) ? row.pausedReason : null,
          pausedAt: row.pausedAt,
          capExtension: row.capExtension,
        },
      ]),
    );
  }

  async sumUnitsGiven(ruleIds: readonly string[]): Promise<Map<string, number>> {
    if (ruleIds.length === 0) return new Map();
    const rows = await this.grants
      .createQueryBuilder('g')
      .select('g."ruleId"', 'ruleId')
      .addSelect('COALESCE(SUM(g."quantity"), 0)', 'units')
      .where('g."ruleId" IN (:...ruleIds)', { ruleIds: [...ruleIds] })
      .groupBy('g."ruleId"')
      .getRawMany<{ ruleId: string; units: string }>();
    return new Map(rows.map((row) => [row.ruleId, Number(row.units)]));
  }

  async sumUnitsForCustomer(
    ruleIds: readonly string[],
    customerId: string,
  ): Promise<Map<string, number>> {
    if (ruleIds.length === 0) return new Map();
    const rows = await this.grants
      .createQueryBuilder('g')
      .select('g."ruleId"', 'ruleId')
      .addSelect('COALESCE(SUM(g."quantity"), 0)', 'units')
      .where('g."ruleId" IN (:...ruleIds)', { ruleIds: [...ruleIds] })
      .andWhere('g."customerId" = :customerId', { customerId })
      .groupBy('g."ruleId"')
      .getRawMany<{ ruleId: string; units: string }>();
    return new Map(rows.map((row) => [row.ruleId, Number(row.units)]));
  }

  async findGrantsForOrder(internalOrderId: string): Promise<GiftGrant[]> {
    const rows = await this.grants.find({ where: { internalOrderId } });
    return rows.map((row) => ({
      ruleId: row.ruleId,
      internalOrderId: row.internalOrderId,
      customerId: row.customerId,
      quantity: row.quantity,
      createdAt: row.createdAt,
    }));
  }

  async recordGrant(grant: Omit<GiftGrant, 'createdAt'>): Promise<boolean> {
    const result = await this.grants
      .createQueryBuilder()
      .insert()
      .values({
        ruleId: grant.ruleId,
        internalOrderId: grant.internalOrderId,
        customerId: grant.customerId,
        quantity: grant.quantity,
      })
      .orIgnore()
      .returning('id')
      .execute();
    return Array.isArray(result.raw) && result.raw.length > 0;
  }

  async setPause(ruleId: string, reason: GiftRulePauseReason | null): Promise<void> {
    await this.states.query(
      `INSERT INTO "automation_gift_rule_state" ("ruleId", "pausedReason", "pausedAt", "capExtension", "updatedAt")
       VALUES ($1, $2::varchar, CASE WHEN $2::varchar IS NULL THEN NULL ELSE now() END, 0, now())
       ON CONFLICT ("ruleId") DO UPDATE
         SET "pausedReason" = EXCLUDED."pausedReason",
             "pausedAt" = CASE
               WHEN EXCLUDED."pausedReason" IS NULL THEN NULL
               WHEN "automation_gift_rule_state"."pausedReason" IS NOT DISTINCT FROM EXCLUDED."pausedReason"
                 THEN "automation_gift_rule_state"."pausedAt"
               ELSE now() END,
             "updatedAt" = now()`,
      [ruleId, reason],
    );
  }

  async extendCap(ruleId: string, extraUnits: number): Promise<void> {
    await this.states.query(
      `INSERT INTO "automation_gift_rule_state" ("ruleId", "pausedReason", "pausedAt", "capExtension", "updatedAt")
       VALUES ($1, NULL, NULL, $2::int, now())
       ON CONFLICT ("ruleId") DO UPDATE
         SET "capExtension" = "automation_gift_rule_state"."capExtension" + $2::int,
             "pausedReason" = CASE WHEN "automation_gift_rule_state"."pausedReason" = 'unit-cap'
                                   THEN NULL ELSE "automation_gift_rule_state"."pausedReason" END,
             "pausedAt" = CASE WHEN "automation_gift_rule_state"."pausedReason" = 'unit-cap'
                               THEN NULL ELSE "automation_gift_rule_state"."pausedAt" END,
             "updatedAt" = now()`,
      [ruleId, extraUnits],
    );
  }
}
