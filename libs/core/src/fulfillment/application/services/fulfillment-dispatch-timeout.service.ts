/**
 * Fulfilment Dispatch Timeout Service (#2712, ADR-054)
 *
 * Reaps `submitted` fulfilment work whose holder never answered. See
 * {@link IFulfillmentDispatchTimeoutService} for the contract and for why this
 * neither re-routes nor clears the holder.
 *
 * ## Boundary
 *
 * Injects the work repository and NOTHING else. This context is a registered
 * zero-sibling-edge leaf, so it may not inject an `orders` service to write
 * `omsAttention` — it REPORTS intents and the worker composes the write
 * (ADR-053's report-don't-perform discipline, the #2400 shape).
 *
 * @module libs/core/src/fulfillment/application/services
 * @implements {IFulfillmentDispatchTimeoutService}
 */
import { Inject, Injectable } from '@nestjs/common';

import type { AuthorityAttentionOutcome } from '@openlinker/core/fulfillment-authority';
import { Logger } from '@openlinker/shared/logging';

import {
  FulfillmentWorkRepositoryPort,
  type TimedOutFulfillmentDispatch,
} from '../../domain/ports/fulfillment-work-repository.port';
import {
  deriveAcceptanceAttention,
  describeFulfillmentDispatchTimeout,
  FULFILLMENT_DISPATCH_TIMEOUT_IS_BLOCKING,
  FULFILLMENT_DISPATCH_TIMEOUT_REASON,
} from '../../domain/types/fulfillment-dispatch-timeout.types';
import { FULFILLMENT_WORK_REPOSITORY_TOKEN } from '../../fulfillment.tokens';
import type {
  FulfillmentAcceptanceAttentionIntent,
  ReapTimedOutDispatchesInput,
  ReapTimedOutDispatchesResult,
} from '../types/fulfillment-dispatch-timeout-sweep.types';
import type { IFulfillmentDispatchTimeoutService } from '../interfaces/fulfillment-dispatch-timeout.service.interface';

@Injectable()
export class FulfillmentDispatchTimeoutService implements IFulfillmentDispatchTimeoutService {
  private readonly logger = new Logger(FulfillmentDispatchTimeoutService.name);

  constructor(
    @Inject(FULFILLMENT_WORK_REPOSITORY_TOKEN)
    private readonly repository: FulfillmentWorkRepositoryPort
  ) {}

  async reapTimedOutDispatches(
    input: ReapTimedOutDispatchesInput
  ): Promise<ReapTimedOutDispatchesResult> {
    const idleBefore = new Date(input.now.getTime() - input.timeoutMs);
    const candidates = await this.repository.listTimedOutDispatches({
      idleBefore,
      limit: input.limit,
    });

    // Built from the SAME resolved number the cutoff above used, so what an
    // operator reads and what reaped the work cannot differ (#2229).
    const detail = describeFulfillmentDispatchTimeout(input.timeoutMs);

    let reaped = 0;
    let raced = 0;
    let skippedUnassigned = 0;
    let failed = 0;
    // Only orders with at least one APPLIED reap. A raced row changed nothing,
    // so recomputing its order would write a verdict this run did not cause.
    const reapedOrderIds = new Set<string>();

    for (const candidate of candidates) {
      const outcome = await this.reapOne(candidate, detail, input.now);
      if (outcome === 'reaped') {
        reaped += 1;
        reapedOrderIds.add(candidate.orderId);
      } else if (outcome === 'raced') {
        raced += 1;
      } else if (outcome === 'skipped-unassigned') {
        skippedUnassigned += 1;
      } else {
        failed += 1;
      }
    }

    // Candidates are ordered oldest-idle first and a row leaves the set only by
    // being written, so a permanently-failing row keeps its `updatedAt`, stays
    // at the head and is re-read every tick — enough of them starve the rest.
    // A scan offset is unavailable here (frontier-as-query), so the condition is
    // SURFACED rather than worked around, exactly as #2346 surfaces its own.
    if (failed > 0 && failed === candidates.length) {
      this.logger.error(
        `fulfillment_timeout_sweep_page_all_failed: every one of ${String(
          candidates.length
        )} candidate(s) failed to reap; the oldest will be re-read next tick and may starve the page`
      );
    }

    return {
      examined: candidates.length,
      reaped,
      raced,
      skippedUnassigned,
      failed,
      timeoutMs: input.timeoutMs,
      attentionIntents: await this.buildAttentionIntents(reapedOrderIds),
    };
  }

  async recomputeAcceptanceAttention(
    orderId: string
  ): Promise<AuthorityAttentionOutcome<'acceptance'>> {
    // Throws on an infrastructure fault rather than reporting `none`: a failed
    // read must never be written as a CLEAR, which would erase a true reason
    // (#2100). The caller treats a throw as "leave the stored entry alone".
    const works = await this.repository.findByOrderId(orderId);
    return deriveAcceptanceAttention(works);
  }

  /**
   * Reap ONE candidate through the unchanged `recordRejection`.
   *
   * No new writer of `requestStatus` is introduced — that column's writer table
   * in the repository names five, and adding an unnamed sixth is the defect the
   * table exists to prevent. The guarded `submitted -> rejected` transition and
   * the rejection row commit together there, so a lost guard inserts nothing.
   */
  private async reapOne(
    candidate: TimedOutFulfillmentDispatch,
    detail: string,
    now: Date
  ): Promise<'reaped' | 'raced' | 'skipped-unassigned' | 'failed'> {
    const connectionId = candidate.assignedConnectionId;
    if (connectionId === null) {
      // A rejection that does not say WHO excludes nobody
      // (`fulfillment-work-rejection.types.ts`). Unreachable through the
      // dispatch path, which throws before claiming — so this is a real
      // anomaly, logged rather than passed over.
      this.logger.warn(
        `Skipping timed-out work ${candidate.workId}: it sits in 'submitted' with no assigned holder`
      );
      return 'skipped-unassigned';
    }

    try {
      const applied = await this.repository.recordRejection({
        workId: candidate.workId,
        orderId: candidate.orderId,
        connectionId,
        assignmentAttempt: candidate.assignmentAttempt,
        // Pins the attempt this run READ — the sweep is a delayed actor.
        expectedAssignmentAttempt: candidate.assignmentAttempt,
        reason: FULFILLMENT_DISPATCH_TIMEOUT_REASON,
        // Never blocking: a silence is OL's inference, not the holder's
        // declaration. See the constant's docblock for the full argument.
        blocking: FULFILLMENT_DISPATCH_TIMEOUT_IS_BLOCKING,
        detail,
        // OL's own observation instant — this one IS ours.
        rejectedAt: now,
      });

      if (!applied) {
        this.logger.log(
          `Timed-out work ${candidate.workId} was not reaped: a peer moved it first (a late answer, a re-request, or a concurrent sweep)`
        );
        return 'raced';
      }

      this.logger.warn(
        `Reaped fulfilment work ${candidate.workId} (order ${candidate.orderId}, holder ${connectionId}, attempt ${String(
          candidate.assignmentAttempt
        )}): ${detail}`
      );
      return 'reaped';
    } catch (error) {
      this.logger.error(
        `Failed to reap timed-out work ${candidate.workId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return 'failed';
    }
  }

  /**
   * Recompute the A3-X verdict for every order this run actually reaped.
   *
   * Reads the WHOLE order's works, which is what makes the answer split-safe:
   * `omsAttention` is keyed `(order, producer)`, so a per-work verdict would let
   * one parcel's state overwrite a sibling's.
   *
   * A failed re-read yields NO intent rather than a cleared one — absence leaves
   * the stored entry untouched, which is the #2100 rule that a transient failure
   * must never erase a true reason.
   */
  private async buildAttentionIntents(
    orderIds: ReadonlySet<string>
  ): Promise<FulfillmentAcceptanceAttentionIntent[]> {
    const intents: FulfillmentAcceptanceAttentionIntent[] = [];

    for (const orderId of orderIds) {
      try {
        // The SAME method the dispatch handler calls, so the sweep's verdict
        // and the handshake's cannot be computed two different ways.
        intents.push({ orderId, outcome: await this.recomputeAcceptanceAttention(orderId) });
      } catch (error) {
        this.logger.error(
          `Could not recompute the acceptance attention state for order ${orderId}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    return intents;
  }
}
