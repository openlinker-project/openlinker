/**
 * Order Edited Notice (#3544, mockup M1 `edit-saved`)
 *
 * The page banner of an order an operator edited: "This order was edited in
 * OpenLinker", what the channel still shows (both figures), and whatever the
 * edit left for the operator to do - confirm the refund the seller makes on the
 * channel, or review the correction of an issued invoice. Both come from a
 * discount on a paid order and are the server's open proposals
 * (`edits.discountProposals`), so the banner survives a reload and shows for a
 * second admin.
 *
 * It is NOT the `amending` banner ("waiting for the channel"): after an edit
 * nothing waits on a channel (D9).
 *
 * The two actions are gated admin AND `orders:write` (the confirm route is
 * `@Roles('admin')`); everyone else still reads the banner.
 *
 * @module apps/web/src/features/orders/components
 */
import { useState, type ReactElement } from 'react';

import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { formatAmount } from '../../../shared/format/format-amount';
import { useIsAdmin, useWriteAccess } from '../../../shared/auth/use-permission';
import { useDemoMode } from '../../system';
import type { ConfirmOrderChangeResult } from '../api/order-cancel.types';
import type { OrderDiscountResult, OrderEditsView } from '../api/order-edit.types';
import {
  DISCOUNT_CORRECTION_UNAVAILABLE_COPY,
  formatDecimalAmount,
} from '../lib/order-edit';
import { OrderCorrectionProposalDialog } from './order-correction-proposal-dialog';
import { OrderDiscountRefundDialog } from './order-discount-refund-dialog';

export interface OrderEditedNoticeProps {
  internalOrderId: string;
  /** `null` / absent for an order nobody edited: nothing is rendered. */
  edits: OrderEditsView | null | undefined;
  /** Display name of the source connection. */
  sourceName: string | null;
  /** The one discount RESPONSE this session holds; see `OrderDetailPage`. */
  sessionDiscount?: OrderDiscountResult | null;
  /** A refund or correction was confirmed; lets the page refresh invoice-side queries. */
  onConfirmed?: (result: ConfirmOrderChangeResult) => void;
}

export function OrderEditedNotice({
  internalOrderId,
  edits,
  sourceName,
  sessionDiscount = null,
  onConfirmed,
}: OrderEditedNoticeProps): ReactElement | null {
  const demoMode = useDemoMode();
  const write = useWriteAccess('orders:write', demoMode);
  const isAdmin = useIsAdmin();
  const canAct = write.canWrite && isAdmin;
  const [refundOpen, setRefundOpen] = useState(false);
  const [correctionOpen, setCorrectionOpen] = useState(false);

  if (!edits) return null;

  const channel = sourceName ?? 'the sales channel';
  const refund = edits.discountProposals.find((p) => p.kind === 'order.discount_refund') ?? null;
  const correction =
    edits.discountProposals.find((p) => p.kind === 'order.discount_correction') ?? null;
  const unavailable = correction === null ? (sessionDiscount?.correctionUnavailableReason ?? null) : null;
  const totals = edits.totals;
  const lowered = edits.lines.length;

  return (
    <>
      <Alert tone="info" title="This order was edited in OpenLinker" data-testid="order-edit-notice">
        <p>
          {`${channel} still shows the order as the buyer placed it${
            totals ? `: ${formatAmount(totals.channelTotal, totals.currency)}` : ''
          }${lowered > 0 ? `, with ${lowered === 1 ? 'one line' : `${lowered} lines`} you lowered here` : ''}.`}
          {totals && totals.total !== totals.channelTotal
            ? ` The order here is ${formatAmount(totals.total, totals.currency)}.`
            : ''}
        </p>
        {edits.cod && edits.cod.amount !== null && edits.cod.amount !== edits.cod.channelAmount ? (
          <p data-testid="order-edit-cod">
            {`Cash on delivery: collect ${formatDecimalAmount(edits.cod.amount, edits.cod.currency)} (${channel} has ${formatDecimalAmount(edits.cod.channelAmount, edits.cod.currency)}).`}
          </p>
        ) : null}
        {refund ? (
          <p data-testid="order-edit-refund-pending">
            {`Refund ${refund.amount ? formatDecimalAmount(refund.amount, refund.currency) : 'the difference'} on ${channel}, then confirm the refund here.`}
            {canAct ? (
              <>
                {' '}
                <Button
                  type="button"
                  tone="secondary"
                  className="button--sm"
                  data-testid="order-edit-confirm-refund"
                  onClick={() => {
                    setRefundOpen(true);
                  }}
                >
                  Confirm refund
                </Button>
              </>
            ) : null}
          </p>
        ) : null}
        {correction ? (
          <p data-testid="order-edit-correction-pending">
            Review and issue the correction invoice for the discount. Nothing is issued until you
            confirm it.
            {canAct ? (
              <>
                {' '}
                <Button
                  type="button"
                  tone="secondary"
                  className="button--sm"
                  data-testid="order-edit-review-correction"
                  onClick={() => {
                    setCorrectionOpen(true);
                  }}
                >
                  Review correction
                </Button>
              </>
            ) : null}
          </p>
        ) : null}
        {unavailable ? (
          <p data-testid="order-edit-correction-unavailable">
            {DISCOUNT_CORRECTION_UNAVAILABLE_COPY[unavailable]}
          </p>
        ) : null}
        {sessionDiscount?.refundIntentFailed ? (
          <p data-testid="order-edit-refund-intent-failed">
            The discount was saved, but OpenLinker could not open the refund for it. Refund the
            difference on {channel} and record it from Confirm refund.
          </p>
        ) : null}
      </Alert>

      {refund ? (
        <OrderDiscountRefundDialog
          open={refundOpen}
          onOpenChange={setRefundOpen}
          internalOrderId={internalOrderId}
          changeId={refund.changeId}
          amount={refund.amount}
          currency={refund.currency}
          channelName={sourceName}
          onConfirmed={onConfirmed}
        />
      ) : null}
      {correction ? (
        <OrderCorrectionProposalDialog
          open={correctionOpen}
          onOpenChange={setCorrectionOpen}
          internalOrderId={internalOrderId}
          kind="order.discount_correction"
          priceLines={correction.lines}
          proposal={{
            changeId: correction.changeId,
            invoiceRecordId: correction.invoiceRecordId ?? '',
            documentNumber: correction.documentNumber,
            currency: correction.currency,
            lines: [],
          }}
          onConfirmed={(result) => {
            onConfirmed?.(result);
          }}
        />
      ) : null}
    </>
  );
}
