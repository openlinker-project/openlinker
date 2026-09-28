/**
 * Fulfilment Parcel Closure Notifier (#3525)
 *
 * Closes the loop the bug names: neither the pack bench's automatic close nor
 * the desktop worklist's manual `close` action ever called
 * `IFulfillmentProgressService.record()`, so no `shipped` progress claim was
 * ever created for OpenLinker-executed work, no dispatch-relay intent was
 * ever composed, and the order's channel learned the parcel shipped only when
 * an operator separately remembered `POST /shipments/:id/notify-dispatched`.
 *
 * ## Why `'shipped'`, not `'closed'`
 *
 * `FulfillmentProgressEventKindValues` carries both, and both are truthful
 * descriptions of a closed parcel — but `FulfillmentProgressService.apply()`'s
 * `'closed'` arm transitions no counters and reports `intents: []`, while its
 * `'shipped'` arm is the ONLY one that returns `{kind: 'dispatch', workId}`.
 * The epic's own product decision — "closing a parcel is what tells the
 * channel it shipped" — is exactly that mapping, so this notifier always
 * records `'shipped'`, never `'closed'`, whichever write closed the parcel.
 *
 * ## No new shipment-creation path
 *
 * This never touches `shipments`. `relayDispatch` drives the existing
 * lifecycle relay (`OrderLifecycleRelayService.relay`), which writes nothing
 * to that table — `ShipmentDispatchService` and the branch-1 status
 * projection remain the only two places a `Shipment` row is minted (#2402).
 *
 * ## Every failure mode is absorbed here, once
 *
 * A `duplicate` / `unknown-work` / `precondition-failed` progress outcome and
 * a `released` / `unknown-work` relay outcome are all ORDINARY, not errors —
 * see each interface's own docblock. Only a genuine throw (infrastructure
 * fault) is caught and logged; nothing here ever propagates, because the
 * parcel close this call reports on has already committed.
 *
 * @module apps/api/src/fulfillment/application/services
 * @implements {IFulfillmentParcelClosureNotifier}
 */
import { Inject, Injectable } from '@nestjs/common';

import {
  buildFulfillmentParcelClosureIdempotencyKey,
  FULFILLMENT_PROGRESS_SERVICE_TOKEN,
  type IFulfillmentProgressService,
} from '@openlinker/core/fulfillment';
import {
  FULFILLMENT_DISPATCH_RELAY_SERVICE_TOKEN,
  type IFulfillmentDispatchRelayService,
} from '@openlinker/core/orders';
import { Logger } from '@openlinker/shared/logging';

import type {
  IFulfillmentParcelClosureNotifier,
  NotifyFulfillmentParcelClosedInput,
} from '../interfaces/fulfillment-parcel-closure-notifier.service.interface';

@Injectable()
export class FulfillmentParcelClosureNotifierService implements IFulfillmentParcelClosureNotifier {
  private readonly logger = new Logger(FulfillmentParcelClosureNotifierService.name);

  constructor(
    @Inject(FULFILLMENT_PROGRESS_SERVICE_TOKEN)
    private readonly progress: IFulfillmentProgressService,
    @Inject(FULFILLMENT_DISPATCH_RELAY_SERVICE_TOKEN)
    private readonly relay: IFulfillmentDispatchRelayService
  ) {}

  async notifyParcelClosed(input: NotifyFulfillmentParcelClosedInput): Promise<void> {
    try {
      const outcome = await this.progress.record({
        kind: 'shipped',
        workId: input.workId,
        connectionId: input.connectionId,
        idempotencyKey: buildFulfillmentParcelClosureIdempotencyKey(input.workId, input.closedAt),
        occurredAt: input.closedAt,
      });

      if (outcome.status === 'duplicate') {
        // An earlier close (bench + worklist can both legally close the same
        // work, or a retried request replayed the identical instant) already
        // reported this fact — the claim table's whole job.
        return;
      }
      if (outcome.status === 'unknown-work') {
        // Unreachable in practice: both callers just loaded this exact work
        // row. Logged rather than ignored, because it would mean a delete
        // raced the close.
        this.logger.warn(
          `Progress record named unknown work ${outcome.workId} immediately after it closed`
        );
        return;
      }
      if (outcome.status === 'precondition-failed') {
        // The `'shipped'` arm writes no counters and transitions no status
        // (see this file's header), so this arm is unreachable for a
        // `'shipped'` event today — recorded defensively rather than assumed.
        this.logger.warn(
          `Progress record for closed work ${input.workId} reported precondition-failed: ${outcome.reason}`
        );
        return;
      }

      for (const intent of outcome.intents) {
        if (intent.kind !== 'dispatch') continue;
        await this.relayDispatch(intent.workId);
      }
    } catch (error) {
      this.logger.error(
        `Could not notify the order's channel that fulfilment work ${input.workId} shipped: ` +
          `${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined
      );
    }
  }

  private async relayDispatch(workId: string): Promise<void> {
    const relayed = await this.relay.relayDispatch({ kind: 'dispatch', workId });

    if (relayed.status === 'released') {
      // A transient failure. `dispatchRelayedAt` is back to NULL, so the
      // #2728 reconcile sweep (`fulfillment.work.relaySweep`) picks it up on
      // its next tick — see that handler for why re-driving it synchronously
      // here would be the wrong shape.
      this.logger.warn(
        `Dispatch relay for work ${workId} did not land (${relayed.reason}); ` +
          'the fulfilment.work.relaySweep reconcile pass will retry it'
      );
      return;
    }
    if (relayed.status === 'unknown-work') {
      this.logger.warn(
        `Dispatch relay named unknown work ${relayed.workId} immediately after it closed`
      );
    }
    // 'relayed' and 'already-relayed' are both the honest steady state —
    // nothing further to do.
  }
}
