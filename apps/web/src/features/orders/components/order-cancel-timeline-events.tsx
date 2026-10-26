/**
 * Order cancel timeline events (#3541, mockup M1 Activity)
 *
 * Maps the order's persisted change proposals and recorded refunds into Activity
 * rows, so the cancel history survives a reload. The timeline learns nothing
 * about cancelling: this builds `TimelineEvent`s and the page hands them over.
 *
 * **"Refund not confirmed yet" is UNDATED, deliberately.** It is a current-state
 * fact ("nobody has confirmed a refund"), not something that happened at an
 * instant. It disappears once a refund is recorded, which then appears as a
 * dated row. Nothing is ever labelled a refund that OpenLinker made: it moves no
 * money.
 *
 * Per-participant outcomes, stock release and voided labels are not persisted, so
 * they come from the one cancel response the session holds (`sessionResult`) and
 * are absent after a reload. The persisted rows still tell the story.
 *
 * @module apps/web/src/features/orders/components
 */
import { ConnectionEntityLabel } from '../../connections';
import type { CancelOrderResult, OrderChangeView } from '../api/order-cancel.types';
import type { OrderRefundRecord } from '../api/order-refund.types';
import { abandonReasonCopy, CANCEL_PARTICIPANT_EFFECT_COPY, orderCancelReasonLabel } from '../lib/order-cancel';
import type { TimelineEvent } from './order-activity-timeline';

export interface OrderCancelTimelineInput {
  changes: readonly OrderChangeView[];
  refunds: readonly OrderRefundRecord[];
  sourceName: string | null;
  /** Session-only extras; see the module docblock. Matched to its change by id. */
  sessionResult?: CancelOrderResult | null;
}

export function buildOrderCancelTimelineEvents(input: OrderCancelTimelineInput): TimelineEvent[] {
  const { changes, refunds, sessionResult } = input;
  const events: TimelineEvent[] = [];
  // Oldest first, so the rows read in the order things happened.
  const ordered = [...changes].reverse();
  let cancelConfirmed = false;

  for (const change of ordered) {
    if (change.kind === 'order.cancel_request') {
      const request = change.payload.cancelRequest;
      events.push({
        id: `cancel-requested:${change.id}`,
        timestamp: change.requestedAt,
        title: `Cancellation requested: ${orderCancelReasonLabel(request?.reason ?? '')}`,
        by: 'operator',
        description:
          request?.note ??
          (change.open ? `Waiting for ${input.sourceName ?? 'the sales channel'} to confirm.` : undefined),
        tone: change.open ? 'warning' : 'default',
      });
      if (change.status === 'confirmed') {
        cancelConfirmed = true;
        events.push({
          id: `cancel-confirmed:${change.id}`,
          timestamp: change.confirmedAt ?? change.requestedAt,
          title: 'Order cancelled',
          by: 'system · writeback',
          description: 'The cancellation was applied.',
          tone: 'success',
        });
        if (sessionResult?.changeId === change.id) {
          events.push(...buildSessionEvents(sessionResult, change.confirmedAt ?? change.requestedAt));
        }
      } else if (change.status === 'declined') {
        events.push({
          id: `cancel-declined:${change.id}`,
          timestamp: change.confirmedAt ?? change.requestedAt,
          title: 'The sales channel refused the cancellation',
          by: 'system · writeback',
          description: change.declinedReason ?? undefined,
          tone: 'error',
        });
      } else if (!change.open && abandonReasonCopy(change.declinedReason, null)) {
        const copy = abandonReasonCopy(change.declinedReason, null);
        events.push({
          id: `cancel-abandoned:${change.id}`,
          timestamp: null,
          title: copy?.title ?? '',
          by: 'system',
          description: copy?.description,
          tone: 'warning',
        });
      } else if (!change.open) {
        events.push({
          id: `cancel-expired:${change.id}`,
          timestamp: null,
          title: 'The cancellation request expired',
          by: 'system',
          description: 'The channel never answered. Cancel the order again if it should still be cancelled.',
          tone: 'warning',
        });
      }
    } else {
      const proposal = change.payload.correction;
      const number = proposal?.documentNumber ? ` for ${proposal.documentNumber}` : '';
      events.push({
        id: `cancel-correction:${change.id}`,
        timestamp: change.requestedAt,
        title: `Correction invoice drafted${number}`,
        by: 'system · invoicing',
        description: change.open ? 'Waiting for you to review and confirm it.' : undefined,
        tone: change.open ? 'warning' : 'default',
      });
      const abandoned = !change.open && change.status !== 'confirmed'
        ? abandonReasonCopy(change.declinedReason, proposal?.documentNumber ?? null)
        : null;
      if (abandoned) {
        events.push({
          id: `cancel-correction-abandoned:${change.id}`,
          timestamp: null,
          title: abandoned.title,
          by: 'system · invoicing',
          description: abandoned.description,
          tone: 'warning',
        });
      }
      if (change.status === 'confirmed') {
        events.push({
          id: `cancel-correction-confirmed:${change.id}`,
          timestamp: change.confirmedAt ?? change.requestedAt,
          title: `Correction invoice confirmed${number}`,
          by: 'operator',
          tone: 'success',
        });
      }
    }
  }

  for (const refund of refunds) {
    events.push({
      id: `refund:${refund.id}`,
      timestamp: refund.recordedAt,
      title: `Refund confirmed: ${refund.amount} ${refund.currency}`,
      by: 'operator',
      description: refund.note ?? 'You recorded that you refunded the buyer.',
      tone: 'success',
    });
  }

  if (cancelConfirmed && refunds.length === 0) {
    events.push({
      id: 'cancel-refund-pending',
      timestamp: null,
      title: 'Refund not confirmed yet',
      by: 'waiting on you',
      description: 'Refund the buyer yourself, then use Confirm refund. OpenLinker does not move money.',
      tone: 'warning',
    });
  }

  return events;
}

function buildSessionEvents(result: CancelOrderResult, at: string): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  for (const participant of result.participants) {
    const copy = CANCEL_PARTICIPANT_EFFECT_COPY[participant.effect];
    events.push({
      id: `cancel-participant:${result.changeId}:${participant.connectionId}:${participant.role}`,
      timestamp: at,
      title: (
        <>
          <ConnectionEntityLabel connectionId={participant.connectionId} />: {copy.label}
        </>
      ),
      by: 'system · writeback',
      description: participant.detail ?? copy.description,
      tone: participant.effect === 'notified' ? 'success' : copy.tone === 'error' ? 'error' : 'warning',
    });
  }
  if (result.voidedShipmentIds.length > 0) {
    events.push({
      id: `cancel-labels:${result.changeId}`,
      timestamp: at,
      title: 'Shipment cancelled',
      by: 'system · shipping',
      // A draft shipment is cancelled too, and it never had a label to void.
      description: `${result.voidedShipmentIds.length} shipment${result.voidedShipmentIds.length === 1 ? ' was' : 's were'} cancelled. A label that was already bought is voided with the carrier.`,
      tone: 'success',
    });
  }
  if (result.stockRestoreEnqueued) {
    events.push({
      id: `cancel-stock:${result.changeId}`,
      timestamp: at,
      title: 'Reserved stock released',
      by: 'system · stock',
      description: 'Stock is being given back and the offers are updated.',
      tone: 'success',
    });
  }
  return events;
}
