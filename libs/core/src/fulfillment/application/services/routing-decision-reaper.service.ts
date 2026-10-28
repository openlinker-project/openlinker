/**
 * Routing Decision Reaper Service (#2731)
 *
 * Closes routing decisions stranded `live` past the routing-decision TTL. See
 * {@link IRoutingDecisionReaperService} for the contract and the safety argument.
 *
 * ## Boundary
 *
 * Injects the decision repository and nothing else. This context is a
 * zero-sibling-edge leaf, so it may not inject an `orders` service to write the
 * order's attention or block: it REPORTS intents and the worker writes them
 * (ADR-053, the #2712 split).
 *
 * @module libs/core/src/fulfillment/application/services
 * @implements {IRoutingDecisionReaperService}
 */
import { Inject, Injectable } from '@nestjs/common';

import { Logger } from '@openlinker/shared/logging';

import type { RoutingDecision } from '../../domain/entities/routing-decision.entity';
import { RoutingDecisionRepositoryPort } from '../../domain/ports/routing-decision-repository.port';
import type { RoutingLockPort } from '../../domain/ports/routing-lock.port';
import {
  describeRoutingDecisionTtl,
  isRoutingDecisionStranded,
  routingDecisionStrandedBefore,
} from '../../domain/types/routing-decision-ttl.types';
import { ROUTING_DECISION_REPOSITORY_TOKEN } from '../../fulfillment.tokens';
import type { IRoutingDecisionReaperService } from '../interfaces/routing-decision-reaper.service.interface';
import { FULFILLMENT_ROUTE_LOCK_TTL_MS, fulfillmentRouteLockKey } from './routing-commit-lock';
import {
  ROUTING_DECISION_REAP_FALLBACK_DETAIL,
  type GetRoutingDecisionStatusInput,
  type ReapStrandedDecisionsInput,
  type ReapStrandedDecisionsResult,
  type RoutingDecisionReapIntent,
  type RoutingDecisionStatusView,
} from '../types/routing-decision-reaper.types';

@Injectable()
export class RoutingDecisionReaperService implements IRoutingDecisionReaperService {
  private readonly logger = new Logger(RoutingDecisionReaperService.name);

  constructor(
    @Inject(ROUTING_DECISION_REPOSITORY_TOKEN)
    private readonly decisions: RoutingDecisionRepositoryPort
  ) {}

  async reapStranded(input: ReapStrandedDecisionsInput): Promise<ReapStrandedDecisionsResult> {
    const candidates = await this.decisions.listStrandedLive({
      createdBefore: routingDecisionStrandedBefore(input.now, input.ttlMs),
      limit: input.limit,
    });

    // Built from the SAME number the cutoff used, so what an operator reads and
    // what reaped the decision cannot differ (#2229).
    const detail = describeRoutingDecisionTtl(input.ttlMs);

    let reaped = 0;
    let raced = 0;
    let busy = 0;
    let failed = 0;
    const intents: RoutingDecisionReapIntent[] = [];

    for (const candidate of candidates) {
      const outcome = await this.reapOne(candidate, input.lock);
      if (outcome === 'reaped') {
        reaped += 1;
        intents.push({
          orderId: candidate.orderId,
          decisionId: candidate.id,
          routerConnectionId: candidate.routerConnectionId,
          attention: { kind: 'blocked', reason: 'routing-stuck', detail },
          fallbackBlock: { reason: 'routing-failed', detail: ROUTING_DECISION_REAP_FALLBACK_DETAIL },
        });
      } else if (outcome === 'raced') {
        raced += 1;
      } else if (outcome === 'busy') {
        busy += 1;
      } else {
        failed += 1;
      }
    }

    // Candidates are oldest first and a row leaves the set only by being
    // written, so a permanently failing one stays at the head and is re-read
    // every tick. A scan offset is unavailable (frontier-as-query), so the
    // condition is surfaced rather than worked around (#2346, #2712).
    if (failed > 0 && failed === candidates.length) {
      this.logger.error(
        `routing_decision_reap_page_all_failed: every one of ${String(
          candidates.length
        )} stranded decision(s) failed to reap; the oldest will be re-read next tick and may starve the page`
      );
    }

    return {
      examined: candidates.length,
      reaped,
      raced,
      busy,
      failed,
      ttlMs: input.ttlMs,
      intents,
    };
  }

  async getStatusForOrder(
    input: GetRoutingDecisionStatusInput
  ): Promise<RoutingDecisionStatusView | null> {
    const decision = await this.decisions.findLatestByOrderId(input.orderId);
    if (decision === null) return null;

    const stranded = isRoutingDecisionStranded(decision, input.now, input.ttlMs);
    return {
      decisionId: decision.id,
      state: decision.state,
      routerConnectionId: decision.routerConnectionId,
      createdAt: decision.createdAt,
      ageMs: Math.max(0, input.now.getTime() - decision.createdAt.getTime()),
      ttlMs: input.ttlMs,
      strandedSince: stranded ? new Date(decision.createdAt.getTime() + input.ttlMs) : null,
      abandonReason: decision.abandonReason,
      terminalisedAt: decision.terminalisedAt,
    };
  }

  /**
   * Reap ONE candidate through the unchanged `terminalise`, holding the order's
   * routing lock.
   *
   * The lock is what makes the reap safe. The candidate's age counts from
   * `createdAt`, but a resumed decision calls the router again without writing
   * the row, so an old decision can still have a call in flight. Every
   * `route()` call holds `fulfillment:route:{orderId}` for longer than its
   * budget; when we hold it instead, no call is running. A held lock means
   * `busy`: leave the decision live and look again next tick.
   *
   * No `routerDecisionRef`: the router named nothing, and a silence is OL's
   * inference, never recorded as something the router declared (#2243).
   */
  private async reapOne(
    candidate: RoutingDecision,
    lock: RoutingLockPort
  ): Promise<'reaped' | 'raced' | 'busy' | 'failed'> {
    const lockKey = fulfillmentRouteLockKey(candidate.orderId);
    let token: string | null;
    try {
      token = await lock.acquire(lockKey, FULFILLMENT_ROUTE_LOCK_TTL_MS);
    } catch (error) {
      this.logger.error(
        `Failed to take the routing lock for stranded decision ${candidate.id}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return 'failed';
    }

    if (token === null) {
      this.logger.log(
        `Stranded routing decision ${candidate.id} was not reaped: order ${candidate.orderId} ` +
          `is being routed right now`
      );
      return 'busy';
    }

    try {
      const applied = await this.decisions.terminalise({
        decisionId: candidate.id,
        state: 'abandoned',
        abandonReason: 'stranded-past-ttl',
        routerDecisionRef: null,
      });

      if (!applied) {
        this.logger.log(
          `Stranded routing decision ${candidate.id} was not reaped: a peer terminalised it first`
        );
        return 'raced';
      }

      // Warn level and a fixed token: a reap is a correct recovery, not a
      // failure, but it means an order waited past the TTL with nothing routing
      // it, which an operator should be able to alert on. A router that keeps
      // going in doubt is reaped again every TTL, and this line is what makes
      // that repetition visible rather than silent.
      this.logger.warn(
        `routing_decision_reaped decisionId=${candidate.id} orderId=${candidate.orderId} ` +
          `router=${candidate.routerConnectionId} createdAt=${candidate.createdAt.toISOString()}`
      );
      return 'reaped';
    } catch (error) {
      this.logger.error(
        `Failed to reap stranded routing decision ${candidate.id}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return 'failed';
    } finally {
      try {
        await lock.release(lockKey, token);
      } catch (error) {
        // The lock expires on its own TTL; the reap itself is already decided.
        this.logger.warn(
          `Failed to release ${lockKey}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }
}
