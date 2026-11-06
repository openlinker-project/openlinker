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
import { getMessages, interpolate, formatPlural, getLocale } from '../../../shared/i18n';
import { ConnectionEntityLabel } from '../../connections';
import type { CancelOrderResult, OrderChangeView } from '../api/order-cancel.types';
import type { OrderRefundRecord } from '../api/order-refund.types';
import {
  abandonReasonCopy,
  cancelParticipantEffectCopy,
  orderCancelReasonLabel,
} from '../lib/order-cancel';
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
  const copy = getMessages('orders').orderCancelTimeline;
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
        title: interpolate(copy.requested, { reason: orderCancelReasonLabel(request?.reason ?? '') }),
        by: copy.byOperator,
        description:
          request?.note ??
          (change.open
            ? interpolate(copy.waitingForChannel, { channel: input.sourceName ?? copy.channelFallback })
            : undefined),
        tone: change.open ? 'warning' : 'default',
      });
      if (change.status === 'confirmed') {
        cancelConfirmed = true;
        events.push({
          id: `cancel-confirmed:${change.id}`,
          timestamp: change.confirmedAt ?? change.requestedAt,
          title: copy.cancelled,
          by: copy.bySystemWriteback,
          description: copy.cancelledDescription,
          tone: 'success',
        });
        if (sessionResult?.changeId === change.id) {
          events.push(...buildSessionEvents(sessionResult, change.confirmedAt ?? change.requestedAt));
        }
      } else if (change.status === 'declined') {
        events.push({
          id: `cancel-declined:${change.id}`,
          timestamp: change.confirmedAt ?? change.requestedAt,
          title: copy.declined,
          by: copy.bySystemWriteback,
          description: change.declinedReason ?? undefined,
          tone: 'error',
        });
      } else if (!change.open && abandonReasonCopy(change.declinedReason, null)) {
        const abandoned = abandonReasonCopy(change.declinedReason, null);
        events.push({
          id: `cancel-abandoned:${change.id}`,
          timestamp: null,
          title: abandoned?.title ?? '',
          by: copy.bySystem,
          description: abandoned?.description,
          tone: 'warning',
        });
      } else if (!change.open) {
        events.push({
          id: `cancel-expired:${change.id}`,
          timestamp: null,
          title: copy.expired,
          by: copy.bySystem,
          description: copy.expiredDescription,
          tone: 'warning',
        });
      }
    } else if (change.kind === 'order.cancel_correction') {
      const proposal = change.payload.correction;
      const document = proposal?.documentNumber ?? null;
      events.push({
        id: `cancel-correction:${change.id}`,
        timestamp: change.requestedAt,
        title: document
          ? interpolate(copy.correctionDraftedFor, { document })
          : copy.correctionDrafted,
        by: copy.bySystemInvoicing,
        description: change.open ? copy.correctionWaiting : undefined,
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
          by: copy.bySystemInvoicing,
          description: abandoned.description,
          tone: 'warning',
        });
      }
      if (change.status === 'confirmed') {
        events.push({
          id: `cancel-correction-confirmed:${change.id}`,
          timestamp: change.confirmedAt ?? change.requestedAt,
          title: document
            ? interpolate(copy.correctionConfirmedFor, { document })
            : copy.correctionConfirmed,
          by: copy.byOperator,
          tone: 'success',
        });
      }
    }
  }

  for (const refund of refunds) {
    events.push({
      id: `refund:${refund.id}`,
      timestamp: refund.recordedAt,
      title: interpolate(copy.refundConfirmed, { amount: `${refund.amount} ${refund.currency}` }),
      by: copy.byOperator,
      description: refund.note ?? copy.refundConfirmedDescription,
      tone: 'success',
    });
  }

  if (cancelConfirmed && refunds.length === 0) {
    events.push({
      id: 'cancel-refund-pending',
      timestamp: null,
      title: copy.refundPending,
      by: copy.byWaitingOnYou,
      description: copy.refundPendingDescription,
      tone: 'warning',
    });
  }

  return events;
}

function buildSessionEvents(result: CancelOrderResult, at: string): TimelineEvent[] {
  const copy = getMessages('orders').orderCancelTimeline;
  const events: TimelineEvent[] = [];
  for (const participant of result.participants) {
    const effect = cancelParticipantEffectCopy(participant.effect);
    events.push({
      id: `cancel-participant:${result.changeId}:${participant.connectionId}:${participant.role}`,
      timestamp: at,
      title: (
        <>
          <ConnectionEntityLabel connectionId={participant.connectionId} />: {effect.label}
        </>
      ),
      by: copy.bySystemWriteback,
      description: participant.detail ?? effect.description,
      tone: participant.effect === 'notified' ? 'success' : effect.tone === 'error' ? 'error' : 'warning',
    });
  }
  if (result.voidedShipmentIds.length > 0) {
    events.push({
      id: `cancel-labels:${result.changeId}`,
      timestamp: at,
      title: copy.shipmentsCancelledTitle,
      by: copy.bySystemShipping,
      // A draft shipment is cancelled too, and it never had a label to void.
      description: formatPlural(result.voidedShipmentIds.length, copy.shipmentsCancelled, getLocale()),
      tone: 'success',
    });
  }
  if (result.stockRestoreEnqueued) {
    events.push({
      id: `cancel-stock:${result.changeId}`,
      timestamp: at,
      title: copy.stockReleased,
      by: copy.bySystemStock,
      description: copy.stockReleasedDescription,
      tone: 'success',
    });
  }
  return events;
}
