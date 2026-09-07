/**
 * OMS Routing Rule Repository
 *
 * Reads a connection's live ruleset out of `oms_routing_rules` and narrows it
 * through the coercer on the way. The database column is untrusted input: it
 * outlives the build that wrote it, and an operator or a migration can put a
 * name in it that this build does not know. Narrowing here means a rule this
 * build cannot understand is dropped rather than routed on.
 *
 * ## Two ports, one table (#2953)
 *
 * `RoutingRuleSourcePort` is the router's read — narrowed, window-filtered,
 * unrecognised rows dropped. `RoutingRuleAdminPort` is the operator's CRUD —
 * verbatim columns, unrecognised rows REPORTED rather than hidden, because a row
 * that is silently not routing is precisely the one an operator needs to see.
 *
 * ## "Not retired" is not "`effectiveTo IS NULL`"
 *
 * The admin default scope and the reorder set are `effectiveTo IS NULL OR
 * effectiveTo > now` — the same upper bound `listActiveRules` applies. Using the
 * unique index's `effectiveTo IS NULL` predicate instead would exclude a rule
 * whose retirement is scheduled in the FUTURE, i.e. one the router is evaluating
 * right now, leaving it unreorderable with nothing to say so. The two predicates
 * answer different questions: the index prevents duplicates, this scopes work.
 *
 * @module libs/oms/src/routing
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository, type EntityManager } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';

import { OmsRoutingRuleOrmEntity } from './oms-routing-rule.orm-entity';
import {
  DuplicateLiveRoutingRuleError,
  RoutingRuleNotFoundError,
  RoutingRuleReorderMismatchError,
} from './routing-rule-admin.errors';
import type {
  CreateRoutingRuleInput,
  ListRoutingRulesOptions,
  RoutingRuleAdminPort,
  RoutingRuleRecord,
  UpdateRoutingRuleInput,
} from './routing-rule-admin.port';
import type { RoutingRuleSourcePort } from './routing-rule-source.port';
import { coerceRoutingRule, coerceRoutingRules, type RoutingRule } from './routing-rule.types';

/** The partial unique index this repository translates `23505` from. */
const LIVE_NAME_INDEX = 'UQ_oms_routing_rules_live_name';

@Injectable()
export class OmsRoutingRuleRepository implements RoutingRuleSourcePort, RoutingRuleAdminPort {
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

  async listRules(
    connectionId: string,
    options: ListRoutingRulesOptions = {}
  ): Promise<readonly RoutingRuleRecord[]> {
    const now = options.now ?? new Date();
    const query = this.rules
      .createQueryBuilder('rule')
      .where('rule."connectionId" = :connectionId', { connectionId });

    if (options.includeSuperseded !== true) {
      query.andWhere('(rule."effectiveTo" IS NULL OR rule."effectiveTo" > :now)', { now });
    }

    const rows = await query
      .orderBy('rule."position"', 'ASC')
      .addOrderBy('rule."id"', 'ASC')
      .getMany();

    return rows.map((row) => this.toRecord(row));
  }

  async getRule(connectionId: string, ruleId: string): Promise<RoutingRuleRecord | null> {
    const row = await this.findOwned(connectionId, ruleId);
    return row === null ? null : this.toRecord(row);
  }

  async createRule(input: CreateRoutingRuleInput): Promise<RoutingRuleRecord> {
    const entity = this.rules.create({
      connectionId: input.connectionId,
      position: input.position,
      kind: input.kind,
      name: input.name,
      afterAction: input.afterAction,
      priorityLocationIds: [...(input.priorityLocationIds ?? [])],
      effectiveFrom: input.effectiveFrom ?? null,
      effectiveTo: input.effectiveTo ?? null,
    });

    const saved = await this.runTranslatingDuplicate(
      () => this.rules.save(entity),
      input.connectionId,
      input.kind,
      input.name
    );

    return this.toRecord(saved);
  }

  /**
   * A NARROW update of only the patched columns — never `save(entity)`.
   *
   * `position` has two writers (this method and `reorderRules`), so a
   * read-modify-write full-row save carries the position read BEFORE a
   * concurrent reorder and writes that stale value back, silently undoing part
   * of the reorder. That is the `fulfillment_works` rule stated in
   * `docs/architecture-overview.md` § Fulfillment ("There is no `save(work)`"),
   * and it applies here for exactly the same reason.
   */
  async updateRule(
    connectionId: string,
    ruleId: string,
    patch: UpdateRoutingRuleInput
  ): Promise<RoutingRuleRecord> {
    const row = await this.findOwned(connectionId, ruleId);
    if (row === null) {
      throw new RoutingRuleNotFoundError(connectionId, ruleId);
    }

    // `undefined` means "not in the patch" and the column is left alone; an
    // explicit `null` on either date means "clear it", which is how a retired
    // rule is brought back. Only named columns reach the UPDATE, so a column
    // this patch does not mention cannot be written with a stale read.
    const columns: QueryDeepPartialEntity<OmsRoutingRuleOrmEntity> = {};
    if (patch.position !== undefined) columns.position = patch.position;
    if (patch.name !== undefined) columns.name = patch.name;
    if (patch.afterAction !== undefined) columns.afterAction = patch.afterAction;
    if (patch.priorityLocationIds !== undefined) {
      columns.priorityLocationIds = [...patch.priorityLocationIds];
    }
    if (patch.effectiveFrom !== undefined) columns.effectiveFrom = patch.effectiveFrom;
    if (patch.effectiveTo !== undefined) columns.effectiveTo = patch.effectiveTo;

    // TypeORM rejects an empty update set, and an empty patch is a legitimate
    // no-op request rather than an error.
    if (Object.keys(columns).length > 0) {
      await this.runTranslatingDuplicate(
        () => this.rules.update({ id: ruleId, connectionId }, columns),
        connectionId,
        // `kind` is not patchable, so the row's own value is the one the index
        // conflicted on; `name` may be the incoming one.
        row.kind,
        patch.name ?? row.name
      );
    }

    // Re-read rather than reconstructing from the patch: `updatedAt` is
    // database-stamped, and a concurrent reorder may legitimately have moved
    // `position` since — the caller should see what the row now IS.
    const updated = await this.findOwned(connectionId, ruleId);
    if (updated === null) {
      throw new RoutingRuleNotFoundError(connectionId, ruleId);
    }
    return this.toRecord(updated);
  }

  async deleteRule(connectionId: string, ruleId: string): Promise<boolean> {
    const result = await this.rules.delete({ id: ruleId, connectionId });
    return (result.affected ?? 0) > 0;
  }

  async reorderRules(
    connectionId: string,
    orderedRuleIds: readonly string[],
    now: Date = new Date()
  ): Promise<readonly RoutingRuleRecord[]> {
    return this.rules.manager.transaction(async (manager: EntityManager) => {
      // Re-read INSIDE the transaction: the exhaustiveness check is only
      // race-free against a concurrent delete or `effectiveTo` patch if the set
      // it compares against is the one being written.
      const rows = await manager
        .createQueryBuilder(OmsRoutingRuleOrmEntity, 'rule')
        .setLock('pessimistic_write')
        .where('rule."connectionId" = :connectionId', { connectionId })
        .andWhere('(rule."effectiveTo" IS NULL OR rule."effectiveTo" > :now)', { now })
        .orderBy('rule."position"', 'ASC')
        .addOrderBy('rule."id"', 'ASC')
        .getMany();

      const actual = new Set(rows.map((row) => row.id));
      const requested = new Set(orderedRuleIds);

      const missing = [...actual].filter((id) => !requested.has(id));
      const unknown = orderedRuleIds.filter((id) => !actual.has(id));
      // A repeated id shrinks `requested` without appearing in `unknown`, so it
      // would otherwise pass both checks while renumbering fewer rules than the
      // caller listed. Length equality is what catches it.
      const duplicated = requested.size !== orderedRuleIds.length;

      if (missing.length > 0 || unknown.length > 0 || duplicated) {
        throw new RoutingRuleReorderMismatchError(connectionId, missing, unknown);
      }

      for (const [index, ruleId] of orderedRuleIds.entries()) {
        await manager.update(OmsRoutingRuleOrmEntity, { id: ruleId, connectionId }, {
          position: index + 1,
        });
      }

      const reordered = await manager
        .createQueryBuilder(OmsRoutingRuleOrmEntity, 'rule')
        .where('rule."connectionId" = :connectionId', { connectionId })
        .andWhere('(rule."effectiveTo" IS NULL OR rule."effectiveTo" > :now)', { now })
        .orderBy('rule."position"', 'ASC')
        .addOrderBy('rule."id"', 'ASC')
        .getMany();

      return reordered.map((row) => this.toRecord(row));
    });
  }

  private async findOwned(
    connectionId: string,
    ruleId: string
  ): Promise<OmsRoutingRuleOrmEntity | null> {
    // Predicated on BOTH columns: a rule owned by another connection must read
    // as absent (404), never as forbidden (403) — a 403 confirms the guessed id
    // names a real rule somewhere, which the caller did not know.
    return this.rules.findOne({ where: { id: ruleId, connectionId } });
  }

  private toRecord(row: OmsRoutingRuleOrmEntity): RoutingRuleRecord {
    const priorityLocationIds = Array.isArray(row.priorityLocationIds)
      ? row.priorityLocationIds.filter((value): value is string => typeof value === 'string')
      : [];

    return {
      id: row.id,
      connectionId: row.connectionId,
      position: row.position,
      kind: row.kind,
      name: row.name,
      afterAction: row.afterAction,
      priorityLocationIds,
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      // The SAME function the read path narrows with, so "listed as recognised"
      // and "routable" cannot drift.
      recognised:
        coerceRoutingRule({
          id: row.id,
          position: row.position,
          kind: row.kind,
          name: row.name,
          afterAction: row.afterAction,
          priorityLocationIds,
        }) !== null,
    };
  }

  private async runTranslatingDuplicate<T>(
    write: () => Promise<T>,
    connectionId: string,
    kind: string,
    name: string
  ): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (this.isLiveNameViolation(error)) {
        throw new DuplicateLiveRoutingRuleError(connectionId, kind, name);
      }
      throw error;
    }
  }

  /**
   * Matches on SQLSTATE **and** constraint name. This table carries a primary
   * key as well, so catching every `23505` would report a PK collision as "a
   * live rule already exists" — the rule #2392 records for exactly this shape.
   */
  private isLiveNameViolation(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) {
      return false;
    }
    const driverError = error.driverError as { code?: unknown; constraint?: unknown } | undefined;
    return driverError?.code === '23505' && driverError?.constraint === LIVE_NAME_INDEX;
  }
}
