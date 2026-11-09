/**
 * Order Discount Refund Dialog (#3544, mockup M1 `edit-saved` "Confirm refund")
 *
 * Confirms the refund intent a discount on a PAID order opened
 * (`order.discount_refund`). OpenLinker executes no refund (ADR-056): confirming
 * means the seller already refunded the buyer on the sales channel, and OpenLinker
 * records that it was done. The label is therefore "Confirm the refund was made",
 * never "Refund".
 *
 * **A refund past the order's ceiling is refused first, then recordable on
 * purpose** (#3289): the backend answers 409 `refund_ceiling_exceeded` with the
 * figures, the dialog shows them next to an explicit tick-box, and only a ticked
 * box resends with `acknowledgeAboveCeiling: true`.
 *
 * @module apps/web/src/features/orders/components
 */
import { useEffect, useState, type ReactElement } from 'react';

import { interpolate, useMessages } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '../../../shared/ui/dialog';
import { useToast } from '../../../shared/ui/toast-provider';
import type { ConfirmOrderChangeResult } from '../api/order-cancel.types';
import { useConfirmOrderChangeMutation } from '../hooks/use-confirm-order-change-mutation';
import {
  readOrderCancelErrorCode,
  readRefundCeilingFigures,
  confirmCorrectionErrorTitle,
  readServerReason,
  remainingRefundable,
} from '../lib/order-cancel';
import { formatDecimalAmount } from '../lib/order-edit';

export interface OrderDiscountRefundDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  internalOrderId: string;
  changeId: string;
  /** The refund the seller owes on the channel, as a decimal string. */
  amount: string | null;
  currency: string;
  /** Display name of the source connection. */
  channelName: string | null;
  onConfirmed?: (result: ConfirmOrderChangeResult) => void;
}

export function OrderDiscountRefundDialog({
  open,
  onOpenChange,
  internalOrderId,
  changeId,
  amount,
  currency,
  channelName,
  onConfirmed,
}: OrderDiscountRefundDialogProps): ReactElement {
  const copy = useMessages('orders').orderDiscountRefund;
  const { showToast } = useToast();
  const mutation = useConfirmOrderChangeMutation();
  const [acknowledged, setAcknowledged] = useState(false);
  const channel = channelName ?? copy.channelFallback;

  const { reset: resetMutation } = mutation;
  useEffect(() => {
    if (open) {
      resetMutation();
      setAcknowledged(false);
    }
  }, [open, resetMutation]);

  const ceiling = mutation.isError ? readRefundCeilingFigures(mutation.error) : null;
  const errorCode = mutation.isError ? readOrderCancelErrorCode(mutation.error) : null;
  const canConfirm = !mutation.isPending && (ceiling === null || acknowledged);

  const confirm = (): void => {
    mutation.mutate(
      {
        internalOrderId,
        changeId,
        // Sent only once the operator has seen the figures and ticked the box.
        ...(acknowledged ? { body: { acknowledgeAboveCeiling: true } } : {}),
      },
      {
        onSuccess: (result) => {
          showToast({ tone: 'success', description: copy.recorded });
          onConfirmed?.(result);
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="order-hold-dialog" data-testid="order-edit-refund-dialog">
        <DialogTitle>
          {amount
            ? interpolate(copy.titleWithAmount, { amount: formatDecimalAmount(amount, currency) })
            : copy.title}
        </DialogTitle>
        <DialogDescription>
          {copy.discountLowered} {interpolate(copy.refundFirst, { channel })}
        </DialogDescription>

        {mutation.isError && ceiling === null ? (
          <Alert
            tone="error"
            title={
              (errorCode ? confirmCorrectionErrorTitle(errorCode) : undefined) ??
              copy.errorTitle
            }
            data-testid="order-edit-refund-error"
          >
            {readServerReason(mutation.error, copy.errorBody)}
          </Alert>
        ) : null}

        {ceiling ? (
          <Alert
            tone="warning"
            title={copy.ceiling.title}
            data-testid="order-edit-refund-ceiling"
          >
            {interpolate(copy.ceiling.body, {
              requested: ceiling.requested,
              remaining: remainingRefundable(ceiling.ceiling, ceiling.alreadyRefunded),
              refunded: ceiling.alreadyRefunded,
              currency: ceiling.currency,
            })}
            <label className="order-cancel-check">
              <input
                type="checkbox"
                checked={acknowledged}
                data-testid="order-edit-refund-ack"
                onChange={(event) => {
                  setAcknowledged(event.target.checked);
                }}
              />
              <span>{copy.ceiling.acknowledge}</span>
            </label>
          </Alert>
        ) : null}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" tone="secondary" disabled={mutation.isPending}>
              {copy.close}
            </Button>
          </DialogClose>
          <Button
            type="button"
            tone="primary"
            disabled={!canConfirm}
            data-testid="order-edit-refund-confirm"
            onClick={confirm}
          >
            {mutation.isPending ? copy.confirming : copy.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
