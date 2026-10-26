/**
 * Order cancel timeline events (#3541, mockup M1 Activity)
 *
 * Maps the one cancel result the page holds into Activity rows. The timeline
 * learns nothing about cancelling: this builds `TimelineEvent`s and the page
 * hands them over (the `extraEvents` precedent, #2383).
 *
 * **"Refund not confirmed yet" is UNDATED, deliberately.** It is a current-state
 * fact ("nobody has confirmed a refund"), not something that happened at an
 * instant, and dating it would assert a moment the data does not support. It is
 * also never labelled a refund done: OpenLinker moves no money.
 *
 * The result is session-local (see `OrderCancelResultNotice`), so these rows
 * appear for the operator who cancelled and not after a reload.
 *
 * @module apps/web/src/features/orders/components
 */
import { ConnectionEntityLabel } from '../../connections';
import type { CancelOrderResult, OrderCancelReason } from '../api/order-cancel.types';
import { CANCEL_PARTICIPANT_EFFECT_COPY, orderCancelReasonLabel } from '../lib/order-cancel';
import type { TimelineEvent } from './order-activity-timeline';

export interface OrderCancelTimelineInput {
  result: CancelOrderResult;
  reason: OrderCancelReason | string;
  /** When the response arrived. OpenLinker's own act, so OpenLinker's clock. */
  requestedAt: string;
  sourceName: string | null;
}

export function buildOrderCancelTimelineEvents(input: OrderCancelTimelineInput): TimelineEvent[] {
  const { result, requestedAt } = input;
  const events: TimelineEvent[] = [
    {
      id: `cancel-requested:${result.changeId}`,
      timestamp: requestedAt,
      title: `Cancellation requested: ${orderCancelReasonLabel(input.reason)}`,
      by: 'operator',
      description:
        result.status === 'pending'
          ? `Waiting for ${input.sourceName ?? 'the sales channel'} to confirm.`
          : undefined,
      tone: result.status === 'pending' ? 'warning' : 'default',
    },
  ];
  if (result.status === 'pending') return events;

  const at = result.cancelledAt ?? requestedAt;

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
      title: 'Shipping label voided',
      by: 'system · shipping',
      description: `${result.voidedShipmentIds.length} label${result.voidedShipmentIds.length === 1 ? ' was' : 's were'} voided with the carrier.`,
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

  if (result.correctionProposal) {
    events.push({
      id: `cancel-correction:${result.changeId}`,
      timestamp: at,
      title: `Correction invoice drafted${
        result.correctionProposal.documentNumber ? ` for ${result.correctionProposal.documentNumber}` : ''
      }`,
      by: 'system · invoicing',
      description: 'Waiting for you to review and confirm it.',
      tone: 'warning',
    });
  }

  events.push({
    id: `cancel-refund:${result.changeId}`,
    timestamp: null,
    title: 'Refund not confirmed yet',
    by: 'waiting on you',
    description: 'Refund the buyer yourself. OpenLinker does not move money.',
    tone: 'warning',
  });

  return events;
}
