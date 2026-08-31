/**
 * Routing Decision Repository (#2394, ADR-054 R1, DESIGN §5.3)
 *
 * ## Writer discipline (the #2392 theme, applied to a two-writer table)
 *
 * | Column | Writer |
 * |---|---|
 * | `id` / `orderId` / `routerConnectionId` / `createdAt` | `claimIntent`, insert-only |
 * | `state` / `routerDecisionRef` / `abandonReason` / `terminalisedAt` | `terminalise`, and nothing else |
 * | `updatedAt` | TypeORM's `@UpdateDateColumn`, injected into the conditional UPDATE — pinned by an int-spec rather than asserted here |
 *
 * There is no `save(decision)`. A row is inserted once and mutated exactly once,
 * by one narrow conditional UPDATE, so the four terminal-owned columns cannot be
 * null-then-reset by an unrelated write.
 *
 * @module libs/core/src/fulfillment/infrastructure/persistence/repositories
 */
import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { EntityManager } from 'typeorm';
import { QueryFailedError, Repository } from 'typeorm';

import { RoutingDecision } from '../../../domain/entities/routing-decision.entity';
import { FulfillmentPersistenceError } from '../../../domain/exceptions/fulfillment-persistence.error';
import { RoutingDecisionAlreadyLiveError } from '../../../domain/exceptions/routing-decision-already-live.error';
import type {
  ClaimRoutingIntentInput,
  RoutingDecisionRepositoryPort,
  TerminaliseRoutingDecisionInput,
} from '../../../domain/ports/routing-decision-repository.port';
import { readRoutingDecisionAbandonReason } from '../../../domain/types/routing-decision.types';
import { RoutingDecisionOrmEntity } from '../entities/routing-decision.orm-entity';

/**
 * Minted locally rather than via `formatInternalId`, which is a VALUE import
 * from a sibling context and forbidden to this leaf unconditionally (see
 * `barrel-purity.spec.ts`). A spec beside this file pins the two formats
 * together, so a change to the shared minter fails the build here rather than
 * silently producing a second id shape — the `formatFulfillmentWorkId` (#2392)
 * trade-off, copied deliberately.
 *
 * No `CoreEntityTypeValues` member and no `ENTITY_TYPE_ID_PREFIX` override are
 * added: that map is `Partial<Record<CoreEntityType, string>>`, so a prettier
 * prefix would first require widening a closed union shared by every adapter,
 * for a cosmetic gain.
 */
const formatRoutingDecisionId = (): string =>
  `ol_routingdecision_${randomUUID().replace(/-/g, '')}`;

/** PostgreSQL `unique_violation`. Matched by code, never by message. */
const PG_UNIQUE_VIOLATION = '23505';

const LIVE_ORDER_CONSTRAINT = 'UQ_routing_decisions_live_order';

@Injectable()
export class RoutingDecisionRepository implements RoutingDecisionRepositoryPort {
  constructor(
    @InjectRepository(RoutingDecisionOrmEntity)
    private readonly decisions: Repository<RoutingDecisionOrmEntity>,
  ) {}

  async claimIntent(input: ClaimRoutingIntentInput): Promise<RoutingDecision> {
    const row = new RoutingDecisionOrmEntity();
    row.id = formatRoutingDecisionId();
    row.orderId = input.orderId;
    row.routerConnectionId = input.routerConnectionId;
    // `state` is NOT accepted from the caller: a claim is live by definition,
    // and letting it be supplied would allow inserting an already-terminal row.
    row.state = 'live';
    row.routerDecisionRef = null;
    row.abandonReason = null;
    row.terminalisedAt = null;

    try {
      const saved = await this.decisions.save(row);
      return this.toDomain(saved);
    } catch (error) {
      if (this.isUniqueViolationOn(error, LIVE_ORDER_CONSTRAINT)) {
        throw new RoutingDecisionAlreadyLiveError(input.orderId);
      }
      throw new FulfillmentPersistenceError('claimIntent', error);
    }
  }

  async terminalise(input: TerminaliseRoutingDecisionInput): Promise<boolean> {
    try {
      // Narrowed here rather than in the port: the port must not name TypeORM
      // (`engineering-standards.md § Domain Layer Independence`), and this is
      // the one place that knows the handle is really an `EntityManager`. A
      // SINGLE cast, matching #2392's `create` — going through `unknown` would
      // discard the structural minimum the port type exists to provide, and a
      // wrong handle would then fail inside `getRepository` rather than at the
      // call site.
      const manager = input.transaction as EntityManager | undefined;
      const repo = manager ? manager.getRepository(RoutingDecisionOrmEntity) : this.decisions;

      const result = await repo
        .createQueryBuilder()
        .update(RoutingDecisionOrmEntity)
        .set({
          state: input.state,
          routerDecisionRef: input.routerDecisionRef ?? null,
          abandonReason: input.abandonReason ?? null,
          terminalisedAt: () => 'now()',
        })
        .where('"id" = :id', { id: input.decisionId })
        // `live` is the only legal precondition — terminalise moves live ->
        // terminal, so there is no `expectedState` parameter to pass: a choice
        // that does not exist must not be offered.
        .andWhere(`"state" = 'live'`)
        .execute();

      // The `?? 0` is load-bearing: an `undefined` affected count coercing to a
      // truthy claim is the silent double-apply shape.
      return (result.affected ?? 0) > 0;
    } catch (error) {
      throw new FulfillmentPersistenceError('terminalise', error);
    }
  }

  async findLiveByOrderId(orderId: string): Promise<RoutingDecision | null> {
    try {
      const row = await this.decisions.findOne({ where: { orderId, state: 'live' } });
      return row ? this.toDomain(row) : null;
    } catch (error) {
      throw new FulfillmentPersistenceError('findLiveByOrderId', error);
    }
  }

  async findById(decisionId: string): Promise<RoutingDecision | null> {
    try {
      const row = await this.decisions.findOne({ where: { id: decisionId } });
      return row ? this.toDomain(row) : null;
    } catch (error) {
      throw new FulfillmentPersistenceError('findById', error);
    }
  }

  /**
   * Matches the SQLSTATE **and** the constraint name.
   *
   * This table carries more than one unique constraint (the primary key and the
   * live index), and #2392 established the stricter variant for exactly that
   * reason: catching every `23505` would report a PK collision as "a live
   * decision already exists" — an error naming a state that is fine, about a
   * constraint that did not fail.
   */
  private isUniqueViolationOn(error: unknown, constraint: string): boolean {
    if (!(error instanceof QueryFailedError)) return false;
    const readString = (source: unknown, key: 'code' | 'constraint'): string | undefined => {
      if (typeof source !== 'object' || source === null) return undefined;
      const value = (source as Record<string, unknown>)[key];
      return typeof value === 'string' ? value : undefined;
    };
    const driverError = (error as { driverError?: unknown }).driverError;
    const code = readString(error, 'code') ?? readString(driverError, 'code');
    const name = readString(error, 'constraint') ?? readString(driverError, 'constraint');
    return code === PG_UNIQUE_VIOLATION && name === constraint;
  }

  private toDomain(row: RoutingDecisionOrmEntity): RoutingDecision {
    return new RoutingDecision(
      row.id,
      row.orderId,
      row.routerConnectionId,
      row.state,
      row.routerDecisionRef,
      readRoutingDecisionAbandonReason(row.abandonReason),
      row.terminalisedAt,
      row.createdAt,
      row.updatedAt,
    );
  }
}
