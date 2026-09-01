/**
 * OMS Routing Rule Repository
 *
 * Reads a connection's live ruleset out of `oms_routing_rules` and narrows it
 * through the coercer on the way. The database column is untrusted input: it
 * outlives the build that wrote it, and an operator or a migration can put a
 * name in it that this build does not know. Narrowing here means a rule this
 * build cannot understand is dropped rather than routed on.
 *
 * @module libs/oms/src/routing
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { OmsRoutingRuleOrmEntity } from './oms-routing-rule.orm-entity';
import type { RoutingRuleSourcePort } from './routing-rule-source.port';
import { coerceRoutingRules, type RoutingRule } from './routing-rule.types';

@Injectable()
export class OmsRoutingRuleRepository implements RoutingRuleSourcePort {
  constructor(
    @InjectRepository(OmsRoutingRuleOrmEntity)
    private readonly rules: Repository<OmsRoutingRuleOrmEntity>
  ) {}

  async listActiveRules(connectionId: string, now: Date): Promise<readonly RoutingRule[]> {
    const rows = await this.rules
      .createQueryBuilder('rule')
      .where('rule."connectionId" = :connectionId', { connectionId })
      .andWhere('(rule."effectiveFrom" IS NULL OR rule."effectiveFrom" <= :now)', { now })
      .andWhere('(rule."effectiveTo" IS NULL OR rule."effectiveTo" > :now)', { now })
      .orderBy('rule."position"', 'ASC')
      .addOrderBy('rule."id"', 'ASC')
      .getMany();

    return coerceRoutingRules(
      rows.map((row) => ({
        id: row.id,
        position: row.position,
        kind: row.kind,
        name: row.name,
        afterAction: row.afterAction,
        priorityLocationIds: row.priorityLocationIds,
      }))
    );
  }
}
