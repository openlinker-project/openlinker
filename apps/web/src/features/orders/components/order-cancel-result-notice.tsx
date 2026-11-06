/**
 * Order Cancel Result Notice (#3541, mockup M1 `cancel-progress` banner and
 * `cancel-done`)
 *
 * What the operator is told about a cancel, in the slot the failed-destinations
 * Alert uses.
 *
 * **It renders from the server's record, not from the cancel response.** The
 * order's change proposals (`GET /orders/:id/changes`) say whether a cancel is
 * still waiting for the channel and whether a credit proposal still needs
 * confirming, so the notice survives a reload and shows for a second admin. The
 * cancel mutation only invalidates that read.
 *
 * - open cancel request: "waiting for the channel" (the order reads `amending`).
 * - confirmed cancel request: the order is cancelled and what is LEFT for the
 *   operator is listed: the refund (until one is recorded) and the correction
 *   invoice (until confirmed). When nothing is left the notice disappears.
 *
 * **Payment stays "Paid" until a refund is confirmed**, and the notice points at
 * the `Confirm refund` action.
 *
 * `sessionResult` carries what the server does NOT persist: per-participant
 * outcomes, "stock restored only" and the reason a correction could not be
 * drafted. Those exist only for the session that cancelled, by design, and the
 * notice degrades to the persisted facts without them.
 *
 * @module apps/web/src/features/orders/components
 */
import { useState, type ReactElement } from 'react';

import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { interpolate, useMessages, usePlural } from '../../../shared/i18n';
import { ConnectionEntityLabel } from '../../connections';
import type {
  CancelOrderResult,
  ConfirmOrderChangeResult,
  OrderChangeView,
} from '../api/order-cancel.types';
import { cancelCorrectionUnavailableText, cancelParticipantEffectCopy } from '../lib/order-cancel';
import { OrderCorrectionProposalDialog } from './order-correction-proposal-dialog';

export interface OrderCancelResultNoticeProps {
  internalOrderId: string;
  /** The order's changes from the server, newest first. */
  changes: readonly OrderChangeView[];
  /** At least one refund has been confirmed against the order. */
  refundRecorded: boolean;
  /** Display name of the source connection, for the pending banner. */
  sourceName: string | null;
  /** Formatted order total with currency, for the refund line. */
  totalLabel: string | null;
  /** Session-only extras from the cancel response; see the module docblock. */
  sessionResult?: CancelOrderResult | null;
  /** The correction was confirmed; lets the page refresh invoice-side queries. */
  onCorrectionConfirmed?: (result: ConfirmOrderChangeResult) => void;
}

export function OrderCancelResultNotice({
  internalOrderId,
  changes,
  refundRecorded,
  sourceName,
  totalLabel,
  sessionResult = null,
  onCorrectionConfirmed,
}: OrderCancelResultNoticeProps): ReactElement | null {
  const copy = useMessages('orders').orderCancelResultNotice;
  const plural = usePlural();
  const [reviewOpen, setReviewOpen] = useState(false);

  const cancelRequest = changes.find((change) => change.kind === 'order.cancel_request') ?? null;
  const correction = changes.find((change) => change.kind === 'order.cancel_correction') ?? null;

  if (cancelRequest?.open) {
    const channel = sourceName ?? copy.channelFallback;
    const unreachable =
      sessionResult?.changeId === cancelRequest.id &&
      sessionResult.participants.some(
        (participant) => participant.role === 'source' && participant.effect === 'unreachable',
      );
    return (
      <Alert
        tone="info"
        title={interpolate(copy.pendingTitle, { channel })}
        data-testid="order-cancel-pending"
      >
        {interpolate(unreachable ? copy.pendingUnreachable : copy.pendingAsked, { channel })}
      </Alert>
    );
  }

  if (cancelRequest?.status !== 'confirmed') return null;

  const correctionPayload = correction?.payload.correction ?? null;
  const correctionOpen = correction !== null && correction.open && correctionPayload !== null;
  const correctionConfirmed = correction?.status === 'confirmed';
  const unavailable = !correction ? (sessionResult?.correctionUnavailableReason ?? null) : null;
  const refundLeft = !refundRecorded;
  const leftForYou = (refundLeft ? 1 : 0) + (correctionOpen ? 1 : 0) + (unavailable ? 1 : 0);
  const notable = (sessionResult?.participants ?? []).filter(
    (participant) => participant.effect !== 'notified',
  );
  const relayFailed = sessionResult?.otherParticipantsRelayFailed === true;

  // Nothing left to do and nothing worth warning about: the history is on the timeline.
  if (leftForYou === 0 && notable.length === 0 && !relayFailed) return null;

  return (
    <>
      <Alert
        tone="warning"
        title={
          leftForYou === 0 ? copy.done : plural(leftForYou, copy.doneWithLeft)
        }
        data-testid="order-cancel-done"
        action={
          correctionOpen ? (
            <Button
              type="button"
              tone="secondary"
              className="button--sm"
              data-testid="order-cancel-review-correction"
              onClick={() => {
                setReviewOpen(true);
              }}
            >
              {copy.reviewCorrection}
            </Button>
          ) : undefined
        }
      >
        <ol className="order-cancel-list">
          {refundLeft ? (
            <li data-testid="order-cancel-done-refund">
              {totalLabel ? interpolate(copy.refundAmount, { amount: totalLabel }) : copy.refund}
            </li>
          ) : null}
          {correctionOpen ? (
            <li data-testid="order-cancel-done-correction">
              {interpolate(copy.correction, {
                document: correctionPayload.documentNumber ?? copy.documentFallback,
              })}
            </li>
          ) : null}
          {unavailable ? (
            <li data-testid="order-cancel-done-correction-unavailable">
              {cancelCorrectionUnavailableText(unavailable)}
            </li>
          ) : null}
          {correctionConfirmed && correctionPayload ? (
            <li data-testid="order-cancel-done-correction-confirmed">
              {interpolate(copy.correctionConfirmed, {
                document: correctionPayload.documentNumber ?? copy.documentFallback,
              })}
            </li>
          ) : null}
        </ol>

        {notable.length > 0 || relayFailed ? (
          <ul className="order-cancel-list" data-testid="order-cancel-done-participants">
            {notable.map((participant) => {
              const effect = cancelParticipantEffectCopy(participant.effect);
              return (
                <li key={`${participant.connectionId}:${participant.role}`}>
                  <ConnectionEntityLabel connectionId={participant.connectionId} />{' '}
                  <StatusBadge tone={effect.tone} compact>
                    {effect.label}
                  </StatusBadge>{' '}
                  {participant.detail ?? effect.description}
                </li>
              );
            })}
            {relayFailed ? (
              <li>{copy.relayFailed}</li>
            ) : null}
          </ul>
        ) : null}
      </Alert>

      {correctionOpen && correction ? (
        <OrderCorrectionProposalDialog
          open={reviewOpen}
          onOpenChange={setReviewOpen}
          internalOrderId={internalOrderId}
          proposal={{
            changeId: correction.id,
            invoiceRecordId: correctionPayload.invoiceRecordId,
            documentNumber: correctionPayload.documentNumber,
            currency: correctionPayload.currency,
            lines: correctionPayload.lines,
          }}
          onConfirmed={(done) => {
            onCorrectionConfirmed?.(done);
          }}
        />
      ) : null}
    </>
  );
}
