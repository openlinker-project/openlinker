/**
 * Confirm Order Refund Dialog (#3541, mockup M1 `cancel-done` header action)
 *
 * Records that the operator refunded the buyer, reusing the shared
 * `RefundConfirmationForm` the return money panel already uses, so the two
 * surfaces phrase the act one way: the label is `Confirm refund`, the amount
 * starts empty and is never computed, and the currency is the order's, locked.
 *
 * **A refund past the order total is refused first, then recordable on purpose.**
 * The backend answers 409 `refund_ceiling_exceeded` with the figures; this dialog
 * shows them and an explicit "Record it anyway" checkbox, and only a ticked box
 * resends with `acknowledgeAboveCeiling: true`. A single idempotency key per open
 * keeps a retry after a dropped response from recording twice.
 *
 * @module apps/web/src/features/orders/components
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';

import { interpolate, useMessages } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../../shared/ui/dialog';
import { useToast } from '../../../shared/ui/toast-provider';
import { useRecordOrderRefundMutation } from '../hooks/use-record-order-refund-mutation';
import { readRefundCeilingFigures } from '../lib/order-cancel';
import {
  RefundConfirmationForm,
  type RefundConfirmationSubmission,
} from './refund-confirmation-form';
import { describeApiError } from '../../../shared/api/describe-api-error';

export interface ConfirmOrderRefundDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  internalOrderId: string;
  /** The order's currency, or null when it could not be resolved (the form refuses). */
  currency: string | null;
  /** Order total as a plain decimal string, shown beside the amount as context. */
  orderTotal: string | null;
}

function newIdempotencyKey(): string {
  return `ui-refund-${globalThis.crypto.randomUUID()}`;
}

export function ConfirmOrderRefundDialog({
  open,
  onOpenChange,
  internalOrderId,
  currency,
  orderTotal,
}: ConfirmOrderRefundDialogProps): ReactElement {
  const copy = useMessages('orders').confirmOrderRefund;
  const { showToast } = useToast();
  const mutation = useRecordOrderRefundMutation();
  const [acknowledged, setAcknowledged] = useState(false);
  const keyRef = useRef<string>(newIdempotencyKey());

  const { reset: resetMutation } = mutation;
  useEffect(() => {
    if (open) {
      keyRef.current = newIdempotencyKey();
      setAcknowledged(false);
      resetMutation();
    }
  }, [open, resetMutation]);

  const ceiling = mutation.isError ? readRefundCeilingFigures(mutation.error) : null;

  const submit = (input: RefundConfirmationSubmission): void => {
    if (currency === null) return;
    mutation.mutate(
      {
        internalOrderId,
        amount: input.amount,
        currency,
        reason: input.reason,
        note: input.note?.trim() ? input.note.trim() : undefined,
        idempotencyKey: keyRef.current,
        // Sent only when ticked: an untouched box must not claim a decision
        // the operator never made.
        acknowledgeAboveCeiling: ceiling !== null && acknowledged ? true : undefined,
      },
      {
        onSuccess: () => {
          showToast({ tone: 'success', description: copy.recorded });
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="order-hold-dialog" data-testid="order-refund-dialog">
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogDescription>{copy.description}</DialogDescription>

        {ceiling ? (
          <Alert tone="warning" title={copy.ceiling.title} data-testid="order-refund-ceiling">
            {interpolate(copy.ceiling.recorded, {
              amount: ceiling.alreadyRefunded,
              currency: ceiling.currency,
            })}{' '}
            {interpolate(copy.ceiling.entered, {
              requested: ceiling.requested,
              ceiling: ceiling.ceiling,
              currency: ceiling.currency,
            })}
            <label className="order-cancel-check">
              <input
                type="checkbox"
                checked={acknowledged}
                data-testid="order-refund-acknowledge"
                onChange={(event) => {
                  setAcknowledged(event.target.checked);
                }}
              />
              <span>{copy.ceiling.acknowledge}</span>
            </label>
          </Alert>
        ) : null}

        <RefundConfirmationForm
          currency={currency}
          orderTotal={orderTotal}
          pending={mutation.isPending}
          error={
            mutation.isError && ceiling === null ? describeApiError(mutation.error, 'orders') : null
          }
          onSubmit={submit}
          onCancel={() => {
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
