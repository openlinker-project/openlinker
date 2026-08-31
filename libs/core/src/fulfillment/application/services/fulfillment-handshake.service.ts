/**
 * Fulfilment Handshake Service (#2399, `W3a-10`, ADR-054, DESIGN §5.4)
 *
 * Drives the negotiation axis: `unsubmitted | rejected -> submitted -> accepted |
 * rejected`, and `accepted -> cancellation_requested -> cancellation_accepted |
 * cancellation_rejected`. Every transition is a conditional UPDATE.
 *
 * ## The defect this exists to prevent
 *
 * REVIEW C7: `work:{workId}:{attempt}` re-mints on job retry if `attempt` is the
 * JOB-RUNNER attempt — which changes on exactly the retries the key must
 * survive. A re-minted key is a second fulfilment request to a 3PL, i.e. a
 * DOUBLE-SHIP. So the counter is a persisted column bumped only by a
 * router-driven re-request, and a retry RESUMES the claimed attempt instead of
 * taking a new one.
 *
 * ## What concurrency actually guarantees here — stated precisely
 *
 * Because the resume arm re-issues the outbound call, two concurrent runs CAN
 * both reach `requestFulfillment`. The row guard is therefore **not** what
 * prevents a second outbound call; the port's replay guarantee is ("a repeat
 * under the same key returns the ORIGINAL outcome and never creates a second
 * assignment"). What the guard does buy is the property that actually matters:
 * **exactly one claim, exactly one distinct idempotency key, at most one
 * increment**. Two calls under ONE key are safe by contract; two calls under TWO
 * keys are the double-ship.
 *
 * ## Boundary
 *
 * The executor and the ship-to arrive as ARGUMENTS. This context is a registered
 * zero-sibling-edge leaf, so it may not inject `IIntegrationsService` (a value
 * import from a sibling) nor any `orders` service (ADR-053's no-injection
 * invariant). See `fulfillment-handshake.types.ts`.
 *
 * @module libs/core/src/fulfillment/application/services
 * @implements {IFulfillmentHandshakeService}
 */
import { Inject, Injectable } from '@nestjs/common';

import { Logger } from '@openlinker/shared/logging';

import { assertFulfillmentRequestResultRecognised } from '../../domain/exceptions/unrecognised-fulfillment-request-result.error';
import { FulfillmentWorkNotFoundError } from '../../domain/exceptions/fulfillment-work-not-found.error';
import { FulfillmentWorkUnassignedError } from '../../domain/exceptions/fulfillment-work-unassigned.error';
import { FulfillmentWorkRepositoryPort } from '../../domain/ports/fulfillment-work-repository.port';
import {
  buildFulfillmentCancellationIdempotencyKey,
  buildFulfillmentDispatchIdempotencyKey,
  type FulfillmentRequestLine,
  type FulfillmentRequestResult,
} from '../../domain/types/fulfillment-execution.types';
import type { FulfillmentRequestStatus } from '../../domain/types/fulfillment-request-status.types';
import type { FulfillmentWork } from '../../domain/types/fulfillment-work.types';
import { FULFILLMENT_WORK_REPOSITORY_TOKEN } from '../../fulfillment.tokens';
import type {
  DispatchFulfillmentWorkInput,
  FulfillmentHandshakeResult,
  RequestFulfillmentCancellationInput,
} from '../types/fulfillment-handshake.types';
import type { IFulfillmentHandshakeService } from './fulfillment-handshake.service.interface';

/**
 * The states a dispatch may be claimed FROM.
 *
 * `unsubmitted` is a first dispatch; `rejected` is a router-driven RE-REQUEST,
 * which is the only thing that legitimately bumps the counter. Every other
 * member is deliberately absent — `submitted` is already claimed, and the
 * accepted/cancellation states must never be silently re-offered.
 */
const CLAIMABLE_FROM: readonly FulfillmentRequestStatus[] = ['unsubmitted', 'rejected'];

const NO_OP: FulfillmentHandshakeResult = {
  outcome: 'no-op',
  idempotencyKey: null,
  assignmentAttempt: null,
  rejectionReason: null,
  blocking: null,
};

@Injectable()
export class FulfillmentHandshakeService implements IFulfillmentHandshakeService {
  private readonly logger = new Logger(FulfillmentHandshakeService.name);

  constructor(
    @Inject(FULFILLMENT_WORK_REPOSITORY_TOKEN)
    private readonly repository: FulfillmentWorkRepositoryPort
  ) {}

  async dispatch(input: DispatchFulfillmentWorkInput): Promise<FulfillmentHandshakeResult> {
    const work = await this.loadWork(input.workId);

    const connectionId = work.assignedConnectionId;
    if (connectionId === null) {
      // Reported by THROWING rather than as a business outcome, deliberately.
      // This slice does not own the enqueue: if #2395's router enqueues before
      // `assignHolder` commits, a terminal answer would dead-end permanently on
      // work that becomes assignable a moment later. The retry ladder absorbs
      // that race; a `business_failure` would not.
      throw new FulfillmentWorkUnassignedError(input.workId);
    }

    const attempt = await this.claimOrResume(work, input.expectedAssignmentAttempt);
    if (attempt === null) return NO_OP;

    const idempotencyKey = buildFulfillmentDispatchIdempotencyKey(work.id, attempt);

    const result = await input.executor.requestFulfillment({
      work: { workId: work.id, connectionId },
      orderId: work.orderId,
      lines: work.lines.map(
        (line): FulfillmentRequestLine => ({
          workLineId: line.id,
          productVariantId: line.productVariantId,
          quantity: line.totalQuantity,
        })
      ),
      shipTo: input.shipTo,
      // Read from the ROW, never taken from the caller: it is an insert-only
      // column the router owns, and a second source could disagree with it.
      deliveryMethod: work.deliveryMethod,
      idempotencyKey,
    });

    // An unrecognised arm is refused rather than persisted. Stamping a status
    // from a shape core does not understand is how a plugin's field becomes a
    // column value nobody chose.
    assertFulfillmentRequestResultRecognised(result);

    return this.recordAnswer(work, connectionId, attempt, idempotencyKey, result);
  }

  async requestCancellation(
    input: RequestFulfillmentCancellationInput
  ): Promise<FulfillmentHandshakeResult> {
    const work = await this.loadWork(input.workId);

    const connectionId = work.assignedConnectionId;
    // Only an ACCEPTED work can be asked back — there is nothing to cancel
    // before a holder took it, and asking anyway would invent a negotiation the
    // holder never entered.
    if (connectionId === null || work.requestStatus !== 'accepted') return NO_OP;

    const claimed = await this.repository.transitionRequestStatus({
      workId: work.id,
      from: ['accepted'],
      to: 'cancellation_requested',
    });
    if (!claimed) return NO_OP;

    // A DISTINCT namespace from the dispatch key for this same attempt. Sharing
    // one would have the executor answer the cancellation with the dispatch's
    // cached `accepted`, so OL would record `cancellation_accepted` for a
    // cancellation the holder never saw.
    const idempotencyKey = buildFulfillmentCancellationIdempotencyKey(
      work.id,
      work.assignmentAttempt
    );

    const result = await input.executor.requestCancellation({
      work: { workId: work.id, connectionId },
      reason: input.reason,
      idempotencyKey,
    });
    assertFulfillmentRequestResultRecognised(result);

    const to: FulfillmentRequestStatus =
      result.status === 'accepted' ? 'cancellation_accepted' : 'cancellation_rejected';

    const applied = await this.repository.transitionRequestStatus({
      workId: work.id,
      from: ['cancellation_requested'],
      to,
    });
    if (!applied) {
      this.logger.warn(
        `Cancellation answer for work ${work.id} lost its transition race; a peer recorded first`
      );
      return NO_OP;
    }

    return {
      outcome: result.status === 'accepted' ? 'cancellation-accepted' : 'cancellation-rejected',
      idempotencyKey,
      assignmentAttempt: work.assignmentAttempt,
      rejectionReason: result.status === 'rejected' ? result.reason : null,
      blocking: result.status === 'rejected' ? result.blocking : null,
    };
  }

  /**
   * Claim a fresh attempt, or resume the one this job was enqueued for.
   *
   * Returns `null` for every state where nothing should be sent.
   */
  private async claimOrResume(
    work: FulfillmentWork,
    expectedAttempt: number | null
  ): Promise<number | null> {
    const claimed = await this.repository.claimDispatchAttempt({
      workId: work.id,
      from: CLAIMABLE_FROM,
    });
    if (claimed !== null) return claimed;

    // The claim did not apply. Re-read rather than trusting the row loaded
    // before it: a peer may have moved the work in between, and resuming on a
    // stale copy is how a retry mints a key for an attempt that no longer exists.
    const current = await this.loadWork(work.id);

    if (current.requestStatus !== 'submitted') {
      // `accepted`, `cancellation_requested` and the two terminal cancellation
      // states all mean "not ours to send". `cancellation_requested` is listed
      // deliberately: it is IN-FLIGHT on the other axis rather than terminal, and
      // re-offering work whose return is being negotiated would put two live
      // requests to one holder.
      return null;
    }

    if (expectedAttempt !== null && current.assignmentAttempt !== expectedAttempt) {
      // A delayed duplicate for an older attempt, waking after a re-request.
      // Sending here would mint a key this job never claimed, for a holder it
      // was not enqueued against.
      this.logger.warn(
        `Dispatch for work ${work.id} was enqueued for attempt ${expectedAttempt} but the work now holds ${current.assignmentAttempt}; not sending`
      );
      return null;
    }

    // The retry path: same persisted attempt, therefore the IDENTICAL key. Safe
    // to re-issue because the port guarantees a repeat under one key returns the
    // original outcome.
    return current.assignmentAttempt;
  }

  private async recordAnswer(
    work: FulfillmentWork,
    connectionId: string,
    attempt: number,
    idempotencyKey: string,
    result: FulfillmentRequestResult
  ): Promise<FulfillmentHandshakeResult> {
    if (result.status === 'accepted') {
      const applied = await this.repository.recordAcceptance({
        workId: work.id,
        acceptedAt: result.acceptedAt,
        externalWorkId: result.externalWorkId,
      });
      if (!applied) {
        // A peer recorded the holder's answer first. Not an error and not a
        // reason to call again — the answer is already durable.
        this.logger.warn(`Acceptance for work ${work.id} lost its claim race; already recorded`);
        return NO_OP;
      }
      return {
        outcome: 'accepted',
        idempotencyKey,
        assignmentAttempt: attempt,
        rejectionReason: null,
        blocking: null,
      };
    }

    const applied = await this.repository.recordRejection({
      workId: work.id,
      orderId: work.orderId,
      connectionId,
      assignmentAttempt: attempt,
      reason: result.reason,
      blocking: result.blocking,
      detail: result.detail,
      rejectedAt: new Date(),
    });
    if (!applied) {
      this.logger.warn(`Rejection for work ${work.id} lost its transition race; already recorded`);
      return NO_OP;
    }

    return {
      outcome: 'rejected',
      idempotencyKey,
      assignmentAttempt: attempt,
      rejectionReason: result.reason,
      blocking: result.blocking,
    };
  }

  private async loadWork(workId: string): Promise<FulfillmentWork> {
    const work = await this.repository.findById(workId);
    if (work === null) throw new FulfillmentWorkNotFoundError(workId);
    return work;
  }
}

