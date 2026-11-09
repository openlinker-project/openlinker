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
import { useEditOrderMutation, type EditOrderOutput } from '../hooks/use-edit-order-mutation';
import { readServerReason } from '../lib/order-cancel';

import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { interpolate, useFormat, useMessages, usePlural } from '../../../shared/i18n';
import { useIsAdmin, useWriteAccess } from '../../../shared/auth/use-permission';
import { useDemoMode } from '../../system';
import type { ConfirmOrderChangeResult } from '../api/order-cancel.types';
import type {
  OrderDiscountResult,
  OrderEditLineStock,
  OrderEditsView,
} from '../api/order-edit.types';
import {
  describeStockOutcome,
  discountCorrectionUnavailableText,
  formatDecimalAmount,
} from '../lib/order-edit';
import { OrderCorrectionProposalDialog } from './order-correction-proposal-dialog';
import { describeCombinedDiscount } from '../lib/combined-discount';
import { OrderDiscountRefundDialog } from './order-discount-refund-dialog';

export interface OrderEditedNoticeProps {
  internalOrderId: string;
  /** `null` / absent for an order nobody edited: nothing is rendered. */
  edits: OrderEditsView | null | undefined;
  /** Display name of the source connection. */
  sourceName: string | null;
  /** The one discount RESPONSE this session holds; see `OrderDetailPage`. */
  sessionDiscount?: OrderDiscountResult | null;
  /** What the session's last line edit did to stock; not persisted, gone on reload. */
  sessionStock?: readonly OrderEditLineStock[] | null;
  /** Lines of the last edit whose packing work was not narrowed (session only). */
  sessionWorkFailureCount?: number;
  /** A refund or correction was confirmed; lets the page refresh invoice-side queries. */
  onConfirmed?: (result: ConfirmOrderChangeResult) => void;
  /** The discount was re-sent (retrying a refund that could not be opened). */
  onDiscountResent?: (outputs: readonly EditOrderOutput[]) => void;
}

/** An edits view whose only content is a removed (zero) discount: nothing is left to say. */
function isOnlyRemovedDiscount(edits: OrderEditsView): boolean {
  const discount = edits.discount;
  const zero = discount === null || Number(discount.amount) === 0;
  return (
    zero &&
    edits.address === null &&
    edits.lines.length === 0 &&
    edits.deliveryMethod === null &&
    edits.discountProposals.length === 0 &&
    (edits.unmatchedLineEdits ?? []).length === 0
  );
}

export function OrderEditedNotice({
  internalOrderId,
  edits,
  sourceName,
  sessionDiscount = null,
  sessionStock = null,
  sessionWorkFailureCount = 0,
  onConfirmed,
  onDiscountResent,
}: OrderEditedNoticeProps): ReactElement | null {
  const copy = useMessages('orders').orderEditedNotice;
  const format = useFormat();
  const plural = usePlural();
  const demoMode = useDemoMode();
  const write = useWriteAccess('orders:write', demoMode);
  const isAdmin = useIsAdmin();
  const canAct = write.canWrite && isAdmin;
  const [refundOpen, setRefundOpen] = useState(false);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const resend = useEditOrderMutation();

  if (!edits || isOnlyRemovedDiscount(edits)) return null;

  const channel = sourceName ?? copy.channelFallback;
  const refund = edits.discountProposals.find((p) => p.kind === 'order.discount_refund') ?? null;
  const correction =
    edits.discountProposals.find((p) => p.kind === 'order.discount_correction') ?? null;
  const unavailable =
    correction === null ? sessionDiscount?.correctionUnavailableReason ?? null : null;
  const totals = edits.totals;
  const lowered = edits.lines.length;
  const unmatched = edits.unmatchedLineEdits ?? [];
  const stockOutcome = describeStockOutcome(sessionStock ?? [], format.list);
  const sessionAmount = sessionDiscount?.discount?.amount ?? null;
  const combinedDiscountText = totals
    ? describeCombinedDiscount(
        totals,
        edits.discount ? Number(edits.discount.amount) : null,
        sourceName
      )
    : null;
  const channelTotal = totals ? format.money(totals.channelTotal, totals.currency) : null;
  const stillShows =
    channelTotal !== null
      ? lowered > 0
        ? plural(lowered, copy.stillShowsTotalLowered, { channel, total: channelTotal })
        : interpolate(copy.stillShowsTotal, { channel, total: channelTotal })
      : lowered > 0
        ? plural(lowered, copy.stillShowsLowered, { channel })
        : interpolate(copy.stillShows, { channel });

  return (
    <>
      <Alert tone="info" title={copy.title} data-testid="order-edit-notice">
        <p>
          {stillShows}
          {totals && totals.total !== totals.channelTotal
            ? ` ${interpolate(copy.orderHere, { amount: format.money(totals.total, totals.currency) })}`
            : ''}
        </p>
        {combinedDiscountText ? (
          <p data-testid="order-edit-combined-discount">{combinedDiscountText}</p>
        ) : null}
        {edits.cod && edits.cod.amount !== null && edits.cod.amount !== edits.cod.channelAmount ? (
          <p data-testid="order-edit-cod">
            {interpolate(copy.cod, {
              amount: formatDecimalAmount(edits.cod.amount, edits.cod.currency),
              channel,
              channelAmount: formatDecimalAmount(edits.cod.channelAmount, edits.cod.currency),
            })}
          </p>
        ) : null}
        {stockOutcome && stockOutcome.tone === 'info' ? (
          <p data-testid="order-edit-stock">{stockOutcome.text}</p>
        ) : null}
        {refund ? (
          <p data-testid="order-edit-refund-pending">
            {interpolate(copy.refundPending, {
              amount: refund.amount
                ? formatDecimalAmount(refund.amount, refund.currency)
                : copy.refundDifference,
              channel,
            })}
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
                  {copy.confirmRefund}
                </Button>
              </>
            ) : null}
          </p>
        ) : null}
        {correction ? (
          <p data-testid="order-edit-correction-pending">
            {copy.correctionPending}
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
                  {copy.reviewCorrection}
                </Button>
              </>
            ) : null}
          </p>
        ) : null}
        {unavailable ? (
          <p data-testid="order-edit-correction-unavailable">
            {discountCorrectionUnavailableText(unavailable)}
          </p>
        ) : null}
        {sessionDiscount?.refundIntentFailed ? (
          <p data-testid="order-edit-refund-intent-failed">
            {interpolate(copy.refundIntentFailed, { channel })}
            {canAct && sessionAmount !== null ? (
              <>
                {' '}
                <Button
                  type="button"
                  tone="secondary"
                  className="button--sm"
                  disabled={resend.isPending}
                  data-testid="order-edit-resend-discount"
                  onClick={() => {
                    resend.mutate(
                      {
                        internalOrderId,
                        edit: { kind: 'discount', body: { amount: sessionAmount } },
                      },
                      { onSuccess: (output) => onDiscountResent?.([output]) }
                    );
                  }}
                >
                  {resend.isPending ? copy.resending : copy.resend}
                </Button>
              </>
            ) : null}
            {resend.isError ? (
              <span role="alert" data-testid="order-edit-resend-error">
                {' '}
                {readServerReason(resend.error, copy.resendFailed)}
              </span>
            ) : null}
          </p>
        ) : null}
      </Alert>
      {sessionWorkFailureCount > 0 ? (
        <Alert tone="warning" title={copy.workFailed.title} data-testid="order-edit-work-failed">
          <p>{plural(sessionWorkFailureCount, copy.workFailed.body)}</p>
        </Alert>
      ) : null}
      {stockOutcome && stockOutcome.tone === 'warning' ? (
        <Alert tone="warning" title={copy.stockFailedTitle} data-testid="order-edit-stock-failed">
          <p>{stockOutcome.text}</p>
        </Alert>
      ) : null}
      {unmatched.length > 0 ? (
        <Alert tone="warning" title={copy.unmatched.title} data-testid="order-edit-unmatched">
          <p>{plural(unmatched.length, copy.unmatched.body, { channel })}</p>
          <ul>
            {unmatched.map((entry) => (
              <li
                key={`${entry.orderLineId}:${entry.editedAt}`}
                data-testid="order-edit-unmatched-line"
              >
                {interpolate(copy.unmatched.line, {
                  line: entry.orderLineId,
                  quantity: entry.editedQuantity,
                  date: format.dateTime(entry.editedAt),
                })}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

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
