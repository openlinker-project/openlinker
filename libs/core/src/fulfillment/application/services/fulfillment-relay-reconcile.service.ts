/**
 * Fulfillment Relay Reconcile Service (#2728, ADR-054)
 *
 * Reads one page of works a holder reported SHIPPED whose dispatch relay never
 * landed, and classifies each against the escalation age. See
 * {@link IFulfillmentRelayReconcileService} for why it reports rather than relays,
 * and `fulfillment-relay-reconcile.types.ts` for why the recovery cannot come from
 * the event stream at all.
 *
 * ## Boundary
 *
 * Injects the work repository and NOTHING else. This context is a registered
 * zero-sibling-edge leaf, so it may not inject the `orders` relay it exists to
 * feed — the worker composes that (ADR-053's report-don't-perform discipline, the
 * #2400 / #2712 shape).
 *
 * ## The progress claim is never released, and that is the point
 *
 * Nothing here touches `fulfillment_progress_claims`. #2400 argues that key is
 * permanent memory rather than a held slot, and un-burning it would let a replayed
 * vendor event re-move counters — the whole reason this recovery is a SWEEP and
 * not a retry. `__tests__/no-progress-claim-release.spec.ts` fails the build if a
 * release is ever introduced.
 *
 * @module libs/core/src/fulfillment/application/services
 * @implements {IFulfillmentRelayReconcileService}
 */
import { Inject, Injectable } from '@nestjs/common';

import { FulfillmentWorkRepositoryPort } from '../../domain/ports/fulfillment-work-repository.port';
import {
  describeFulfillmentRelayStuck,
  isFulfillmentRelayStuck,
} from '../../domain/types/fulfillment-relay-reconcile.types';
import { FULFILLMENT_WORK_REPOSITORY_TOKEN } from '../../fulfillment.tokens';
import type {
  ListUnrelayedDispatchesInput,
  ListUnrelayedDispatchesResult,
  UnrelayedDispatchCandidate,
} from '../types/fulfillment-relay-reconcile-sweep.types';
import type { IFulfillmentRelayReconcileService } from '../interfaces/fulfillment-relay-reconcile.service.interface';

@Injectable()
export class FulfillmentRelayReconcileService implements IFulfillmentRelayReconcileService {
  constructor(
    @Inject(FULFILLMENT_WORK_REPOSITORY_TOKEN)
    private readonly repository: FulfillmentWorkRepositoryPort
  ) {}

  async listUnrelayedDispatches(
    input: ListUnrelayedDispatchesInput
  ): Promise<ListUnrelayedDispatchesResult> {
    const shippedBefore = new Date(input.now.getTime() - input.graceMs);
    const rows = await this.repository.listUnrelayedShippedDispatches({
      shippedBefore,
      limit: input.limit,
    });

    const candidates: UnrelayedDispatchCandidate[] = rows.map((row) => ({
      // The intent shape #2400 already defined, assembled once here so the caller
      // hands it straight to `relayDispatch` rather than re-deriving it.
      intent: { kind: 'dispatch', workId: row.workId },
      orderId: row.orderId,
      shippedAt: row.shippedAt,
      stuck: isFulfillmentRelayStuck(row.shippedAt, input.now, input.stuckAfterMs),
    }));

    return {
      candidates,
      stuckCount: candidates.filter((candidate) => candidate.stuck).length,
      stuckAfterMs: input.stuckAfterMs,
      // Built from the SAME resolved number the classification used, so what an
      // operator reads and what classified the work cannot differ (#2229).
      stuckDetail: describeFulfillmentRelayStuck(input.stuckAfterMs),
    };
  }
}
