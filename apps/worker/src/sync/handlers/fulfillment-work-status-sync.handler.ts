/**
 * Fulfillment Work Status Sync Handler (#2400, `W3a-11`)
 *
 * Handles `fulfillment.work.statusSync` — the job an inbound `fulfillment`-domain
 * webhook routes to.
 *
 * **NOT `marketplace.fulfillment.statusSync`**, which is the shipping context's
 * branch-1 OMP read-back (#834, `MarketplaceFulfillmentStatusSyncHandler`).
 * Unrelated job, unrelated service, unrelated meaning.
 *
 * ## This handler deliberately records NOTHING yet
 *
 * It acknowledges the trigger and completes. That is the honest terminal state
 * of this slice, not an unfinished branch:
 *
 * The only data an inbound webhook can offer is `CanonicalInboundEvent.payload`,
 * which core documents as *"Non-authoritative payload hint; never source of
 * truth"*. Building a `FulfillmentProgressEvent` from it would move
 * `fulfillment_work_lines` counters — real fulfilment state — off an
 * unauthenticated body, which is exactly what the webhook-as-trigger discipline
 * (#904) exists to prevent and why the `master.*` arms carry an external id and
 * nothing else. `FulfillmentWorkStatusSyncPayloadV1` accordingly carries no
 * deltas, so there is nothing here to construct an event from even if it were
 * safe to.
 *
 * The authoritative read is #2398's `FulfillmentStatusSource.getFulfillmentStatus`,
 * which does not exist in the tree. When it lands, THIS is where it plugs in:
 * resolve the reference, pull the authoritative state, and call
 * `IFulfillmentProgressService.record()`. The one change that must NOT be made
 * to make this handler "do something" is widening the payload to carry deltas.
 *
 * Resolving `externalWorkId` to an OL `workId` is #2399's, which owns the writer.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Injectable } from '@nestjs/common';
import type {
  SyncJobHandler,
  SyncJobHandlerResult,
  SyncJob as SyncJobEntity,
  FulfillmentWorkStatusSyncPayloadV1,
} from '@openlinker/core/sync';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';

type SyncJob = SyncJobEntity;

@Injectable()
export class FulfillmentWorkStatusSyncHandler implements SyncJobHandler {
  private readonly logger = new Logger(FulfillmentWorkStatusSyncHandler.name);

  /**
   * Returns a REJECTED promise on a malformed payload rather than throwing
   * synchronously.
   *
   * `execute` is not `async` (there is nothing to await — see the class
   * docblock), so a bare `throw` from `getPayload` would propagate
   * synchronously even though the signature promises a `Promise`. Every sibling
   * handler is `async` and therefore rejects, so a caller that does
   * `handler.execute(job).catch(…)` without also wrapping the call in a
   * `try` would be safe with all of them and crash on this one. The
   * `SyncJobRunner` happens to `await` inside a `try`, so this is a contract
   * inconsistency rather than a live bug — which is exactly why it is worth
   * closing now rather than after something else starts calling handlers.
   */
  execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    let payload: FulfillmentWorkStatusSyncPayloadV1;
    try {
      payload = this.getPayload(job);
    } catch (error) {
      return Promise.reject(error);
    }

    // `log`, not `warn`: this is the designed behaviour of the current slice,
    // not a degradation. A `warn` on every delivery would train an operator to
    // ignore the channel before it carries anything actionable.
    this.logger.log(
      `fulfillment.work.statusSync job ${job.id} acknowledged for connection ${job.connectionId} ` +
        `(externalWorkId=${payload.externalWorkId}, eventType=${payload.eventType}, ` +
        `sourceEventId=${payload.sourceEventId}). No progress recorded: the authoritative ` +
        `read (FulfillmentStatusSource, #2398) does not exist yet, and the webhook body is ` +
        `never a source of truth for fulfilment state.`
    );

    return Promise.resolve({ outcome: 'ok' });
  }

  private getPayload(job: SyncJob): FulfillmentWorkStatusSyncPayloadV1 {
    const payload = job.payload as unknown as Partial<FulfillmentWorkStatusSyncPayloadV1>;
    if (!payload || typeof payload !== 'object') {
      throw new SyncJobExecutionError(
        `Missing payload for job: ${job.id}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }
    if (!payload.externalWorkId || typeof payload.externalWorkId !== 'string') {
      throw new SyncJobExecutionError(
        `Missing or invalid externalWorkId in payload: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }
    // Only `externalWorkId` is guarded, deliberately. It is the one field that
    // IDENTIFIES the subject — without it the job has nothing to act on, now or
    // once #2398 wires the authoritative read. `sourceEventId` and `eventType`
    // are advisory: they reach only the log line below, and the routing policy
    // always populates both, so failing the job over a missing one would turn a
    // cosmetic gap into a dead row. They default to '' rather than being
    // asserted, and that asymmetry is a choice rather than an omission.
    return {
      schemaVersion: 1,
      externalWorkId: payload.externalWorkId,
      sourceEventId: payload.sourceEventId ?? '',
      eventType: payload.eventType ?? '',
      occurredAt: payload.occurredAt,
    };
  }
}
