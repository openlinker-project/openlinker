/**
 * Order Cancel Result Notice (#3541, mockup M1 `cancel-progress` banner and
 * `cancel-done`)
 *
 * What the operator is told after the cancel call returns, in the slot the
 * failed-destinations Alert uses.
 *
 * - `pending` (HTTP 202): the channel has not answered. The request stays open
 *   and the order reads `amending` ("Change pending") in the header.
 * - `cancelled` (HTTP 200): the order is cancelled and TWO things are left for
 *   the operator, because OpenLinker moves no money and cannot withdraw an
 *   issued invoice: the refund, and the correction invoice when there was one.
 *
 * **Payment stays "Paid" until a refund is confirmed**, and the notice says so
 * rather than implying the cancel settled it. A participant that did not simply
 * cancel (stock restored only, unsupported, unreachable, refused) is named, never
 * folded into a green summary.
 *
 * Session-local by design: the cancel result is returned once and persisted by
 * nothing the page reads, so a reload drops this notice. The order's own state
 * (status, phase badge, sync rows) is what survives.
 *
 * @module apps/web/src/features/orders/components
 */
import { useState, type ReactElement } from 'react';

import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { ConnectionEntityLabel } from '../../connections';
import type { CancelOrderResult, ConfirmOrderChangeResult } from '../api/order-cancel.types';
import {
  CANCEL_CORRECTION_UNAVAILABLE_COPY,
  CANCEL_PARTICIPANT_EFFECT_COPY,
} from '../lib/order-cancel';
import { OrderCorrectionProposalDialog } from './order-correction-proposal-dialog';

export interface OrderCancelResultNoticeProps {
  result: CancelOrderResult;
  internalOrderId: string;
  /** Display name of the source connection, for the pending banner. */
  sourceName: string | null;
  /** Formatted order total with currency, for the refund line. */
  totalLabel: string | null;
  /** The correction was confirmed; lets the page refresh invoice-side queries. */
  onCorrectionConfirmed?: (result: ConfirmOrderChangeResult) => void;
}

export function OrderCancelResultNotice({
  result,
  internalOrderId,
  sourceName,
  totalLabel,
  onCorrectionConfirmed,
}: OrderCancelResultNoticeProps): ReactElement {
  const [reviewOpen, setReviewOpen] = useState(false);
  const [confirmed, setConfirmed] = useState<ConfirmOrderChangeResult | null>(null);

  if (result.status === 'pending') {
    const channel = sourceName ?? 'the sales channel';
    return (
      <Alert tone="info" title={`Cancelling: waiting for ${channel}`} data-testid="order-cancel-pending">
        {`OpenLinker asked ${channel} to cancel this order. Stock, connected shops and the correction invoice follow once it confirms.`}
      </Alert>
    );
  }

  const proposal = result.correctionProposal;
  const unavailable = result.correctionUnavailableReason;
  const notable = result.participants.filter((participant) => participant.effect !== 'notified');
  const leftForYou = 1 + (proposal && !confirmed ? 1 : 0) + (unavailable && !proposal ? 1 : 0);

  return (
    <>
      <Alert
        tone="warning"
        title={`Order cancelled: ${leftForYou} thing${leftForYou === 1 ? ' is' : 's are'} left for you`}
        data-testid="order-cancel-done"
        action={
          proposal && !confirmed ? (
            <Button
              type="button"
              tone="secondary"
              className="button--sm"
              data-testid="order-cancel-review-correction"
              onClick={() => {
                setReviewOpen(true);
              }}
            >
              Review correction
            </Button>
          ) : undefined
        }
      >
        <ol className="order-cancel-list">
          <li data-testid="order-cancel-done-refund">
            {`${
              totalLabel ? `Refund ${totalLabel} to the buyer yourself.` : 'Refund the buyer yourself.'
            } OpenLinker does not move money, so the payment keeps reading Paid until a refund is confirmed.`}
          </li>
          {proposal ? (
            <li data-testid="order-cancel-done-correction">
              {confirmed
                ? `The correction for ${proposal.documentNumber ?? 'the invoice'} was confirmed${
                    confirmed.documentNumber ? ` as ${confirmed.documentNumber}` : ''
                  }.`
                : `Review and confirm the correction invoice for ${proposal.documentNumber ?? 'the invoice'}. Nothing is issued until you confirm it.`}
            </li>
          ) : null}
          {unavailable && !proposal ? (
            <li data-testid="order-cancel-done-correction-unavailable">
              {CANCEL_CORRECTION_UNAVAILABLE_COPY[unavailable]}
            </li>
          ) : null}
        </ol>

        {notable.length > 0 || result.otherParticipantsRelayFailed ? (
          <ul className="order-cancel-list" data-testid="order-cancel-done-participants">
            {notable.map((participant) => {
              const copy = CANCEL_PARTICIPANT_EFFECT_COPY[participant.effect];
              return (
                <li key={`${participant.connectionId}:${participant.role}`}>
                  <ConnectionEntityLabel connectionId={participant.connectionId} />{' '}
                  <StatusBadge tone={copy.tone} compact>
                    {copy.label}
                  </StatusBadge>{' '}
                  {participant.detail ?? copy.description}
                </li>
              );
            })}
            {result.otherParticipantsRelayFailed ? (
              <li>
                OpenLinker could not tell the connected shops about the cancellation. Cancel the
                order there by hand.
              </li>
            ) : null}
          </ul>
        ) : null}
      </Alert>

      {proposal ? (
        <OrderCorrectionProposalDialog
          open={reviewOpen}
          onOpenChange={setReviewOpen}
          internalOrderId={internalOrderId}
          proposal={proposal}
          onConfirmed={(done) => {
            setConfirmed(done);
            onCorrectionConfirmed?.(done);
          }}
        />
      ) : null}
    </>
  );
}
