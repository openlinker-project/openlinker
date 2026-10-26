/**
 * Cancel Order Dialog (#3541, mockup M1 `cancel-confirm` / `cancel-progress` /
 * `cancel-label` / `cancel-shipped`)
 *
 * One dialog, four layouts, chosen from the call's outcome rather than from
 * local flags: the confirm form, the "waiting for the channel" progress view
 * (HTTP 202 `pending`), the "cancel the shipment first" refusal and the "already
 * shipped" hard refusal. A successful HTTP 200 closes the dialog and hands the
 * result to the page, whose notice (`OrderCancelResultNotice`) is the `cancel-done`
 * state.
 *
 * **A refusal renders the server's own sentence.** The body carries a machine code
 * and a message naming WHY (the carrier's own words for a label it will not
 * void); the code chooses the layout and the remedy, the message is the reason.
 *
 * **The soft gate is explicit.** Work a holder already accepted at the pack bench
 * needs a ticked box before "Cancel order" enables. The page passes
 * `acceptedWork` when it can derive that from the tasks it already loads; when
 * it could not, the same box appears after the server answers
 * `ORDER_WORK_ACCEPTED_NEEDS_ACK`, and the operator resubmits.
 *
 * The acting user is never sent: the backend stamps it from the session.
 *
 * @module apps/web/src/features/orders/components
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, type ReactElement } from 'react';
import { useForm } from 'react-hook-form';

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
import { FormField } from '../../../shared/ui/form-field';
import { Select } from '../../../shared/ui/select';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { Textarea } from '../../../shared/ui/textarea';
import type { CancelOrderResult, OrderCancelReason } from '../api/order-cancel.types';
import { useCancelOrderMutation } from '../hooks/use-cancel-order-mutation';
import {
  classifyOrderCancelError,
  ORDER_CANCEL_INLINE_TITLES,
  ORDER_CANCEL_NOTE_MAX_LENGTH,
  ORDER_CANCEL_REASON_LABELS,
  OrderCancelReasonValues,
  readOrderCancelErrorCode,
  readServerReason,
} from '../lib/order-cancel';
import {
  cancelOrderSchema,
  type CancelOrderFormValues,
  type CancelOrderSubmission,
} from './cancel-order-dialog.schema';

export interface CancelOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  internalOrderId: string;
  /** The source's own order number, for the title. Falls back to the internal id. */
  orderNumber: string | null;
  /** Display name of the source connection, e.g. "Allegro · ceramika_nowak". */
  sourceName: string | null;
  /** Total units across the order's lines, or null when not known. */
  unitCount: number | null;
  /** Formatted order total with currency, or null when not known. */
  totalLabel: string | null;
  /** The order has an issued invoice, so the cancel opens a correction proposal. */
  invoiced: boolean;
  /** A holder already accepted or started work on this order (the soft gate). */
  acceptedWork: boolean;
  /** Called with the result of a call the channel answered (HTTP 200) or left open (202). */
  onResult: (result: CancelOrderResult, reason: OrderCancelReason) => void;
  /** Scroll to / focus the shipment panel. Used by the label refusal's remedy. */
  onGoToShipment?: () => void;
}

const REASON_DEFAULT = 'buyer-request';

export function CancelOrderDialog({
  open,
  onOpenChange,
  internalOrderId,
  orderNumber,
  sourceName,
  unitCount,
  totalLabel,
  invoiced,
  acceptedWork,
  onResult,
  onGoToShipment,
}: CancelOrderDialogProps): ReactElement {
  const mutation = useCancelOrderMutation();
  const form = useForm<CancelOrderFormValues, undefined, CancelOrderSubmission>({
    defaultValues: { reason: REASON_DEFAULT, note: '', acknowledgeAcceptedWork: false },
    resolver: zodResolver(cancelOrderSchema),
  });

  const { reset: resetForm } = form;
  const { reset: resetMutation } = mutation;
  useEffect(() => {
    if (open) {
      resetForm({ reason: REASON_DEFAULT, note: '', acknowledgeAcceptedWork: false });
      resetMutation();
    }
  }, [open, resetForm, resetMutation]);

  const title = orderNumber ?? internalOrderId;
  const channel = sourceName ?? 'the sales channel';
  const refusal = mutation.isError ? classifyOrderCancelError(mutation.error) : null;
  const pending = mutation.data?.status === 'pending';
  const needsAck = acceptedWork || refusal === 'needs-ack';
  const acknowledged = form.watch('acknowledgeAcceptedWork') === true;
  const canSubmit = !mutation.isPending && (!needsAck || acknowledged);

  const submit = form.handleSubmit((values: CancelOrderSubmission): void => {
    const note = values.note?.trim();
    mutation.mutate(
      {
        internalOrderId,
        reason: values.reason,
        note: note ? note : undefined,
        // Sent only when ticked: an untouched box must not claim an
        // acknowledgement the operator never gave.
        acknowledgeAcceptedWork: values.acknowledgeAcceptedWork === true ? true : undefined,
      },
      {
        onSuccess: (result) => {
          onResult(result, values.reason);
          // `pending` keeps the dialog open on its progress view; a confirmed
          // cancel hands over to the page's result notice.
          if (result.status === 'cancelled') onOpenChange(false);
        },
      },
    );
  });

  const keepButton = (label: string): ReactElement => (
    <DialogClose asChild>
      <Button type="button" tone="secondary" data-testid="order-cancel-keep">
        {label}
      </Button>
    </DialogClose>
  );

  // ---- cancel-progress: the channel has not answered yet -------------------
  if (open && pending) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="order-hold-dialog" data-testid="order-cancel-dialog">
          <div>
            <DialogTitle>{`Cancelling order ${title}`}</DialogTitle>
            <DialogDescription>
              {`Waiting for ${channel} to confirm. You can close this window; the cancellation carries on and shows up in Activity.`}
            </DialogDescription>
            <ol
              className="order-activity"
              aria-label="Cancellation progress"
              data-testid="order-cancel-progress"
            >
              <li className="order-activity__item">
                <span className="order-activity__dot order-activity__dot--warning" aria-hidden="true" />
                <div className="order-activity__body">
                  <p className="order-activity__title">{`Ask ${channel} to cancel`}</p>
                  <p className="order-activity__description">
                    <StatusBadge tone="warning" compact withDot>
                      {`Waiting for ${channel}`}
                    </StatusBadge>
                  </p>
                </div>
              </li>
              <li className="order-activity__item">
                <span className="order-activity__dot order-activity__dot--default" aria-hidden="true" />
                <div className="order-activity__body">
                  <p className="order-activity__title">Cancel the order in connected shops</p>
                  <p className="order-activity__description">Starts after the channel confirms.</p>
                </div>
              </li>
              <li className="order-activity__item">
                <span className="order-activity__dot order-activity__dot--default" aria-hidden="true" />
                <div className="order-activity__body">
                  <p className="order-activity__title">Release reserved units</p>
                  <p className="order-activity__description">Starts after the channel confirms.</p>
                </div>
              </li>
              {invoiced ? (
                <li className="order-activity__item">
                  <span className="order-activity__dot order-activity__dot--default" aria-hidden="true" />
                  <div className="order-activity__body">
                    <p className="order-activity__title">Draft correction invoice</p>
                    <p className="order-activity__description">Ready for you to review.</p>
                  </div>
                </li>
              ) : null}
              <li className="order-activity__item">
                <span className="order-activity__dot order-activity__dot--default" aria-hidden="true" />
                <div className="order-activity__body">
                  <p className="order-activity__title">Refund the buyer</p>
                  <p className="order-activity__description">
                    Your action. OpenLinker does not move money.
                  </p>
                </div>
              </li>
            </ol>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" tone="secondary" data-testid="order-cancel-progress-close">
                  Close
                </Button>
              </DialogClose>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ---- cancel-label: a bought label the carrier will not void --------------
  if (open && refusal === 'label') {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="order-hold-dialog" data-testid="order-cancel-dialog">
          <div>
            <DialogTitle>Cancel the shipment first</DialogTitle>
            <DialogDescription data-testid="order-cancel-label-refusal">
              {readServerReason(
                mutation.error,
                'A shipping label exists for this order, so OpenLinker will not cancel it yet.',
              )}
            </DialogDescription>
            <Alert tone="info" title="What to do">
              <ol className="order-cancel-list">
                <li>Cancel the shipment. This voids its label with the carrier.</li>
                <li>Cancel the order again.</li>
              </ol>
            </Alert>
            <p className="muted-text">
              If the parcel is already with the courier, the label cannot be voided. See the parcel
              instead of cancelling.
            </p>
            <DialogFooter>
              {keepButton('Keep order')}
              <Button
                type="button"
                tone="primary"
                data-testid="order-cancel-label-go-to-shipment"
                onClick={() => {
                  onOpenChange(false);
                  onGoToShipment?.();
                }}
              >
                Go to shipment
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ---- cancel-shipped: hard refusal, the remedy is a return ----------------
  if (open && refusal === 'shipped') {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="order-hold-dialog" data-testid="order-cancel-dialog">
          <div>
            <DialogTitle>This order can not be cancelled</DialogTitle>
            <Alert
              tone="error"
              title="The parcel is on its way"
              data-testid="order-cancel-shipped-refusal"
            >
              {readServerReason(mutation.error, 'This order has already shipped.')}
            </Alert>
            <p className="dialog-section__head">What you can do instead</p>
            <ol className="order-cancel-list">
              <li>
                Ask the buyer to refuse the parcel, or to send it back after delivery. The return
                shows up on this order once the buyer opens it.
              </li>
              <li>Once the goods are back, refund the buyer and confirm the refund here.</li>
              <li>The invoice stays as issued. The return proposes the correction invoice.</li>
            </ol>
            <DialogFooter>{keepButton('Close')}</DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ---- cancel-confirm ------------------------------------------------------
  const inlineCode = readOrderCancelErrorCode(mutation.error);
  const reasonValue = form.watch('reason');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="order-hold-dialog" data-testid="order-cancel-dialog">
        <DialogTitle>{`Cancel order ${title}?`}</DialogTitle>
        <DialogDescription>
          {`OpenLinker asks ${channel} to cancel it. Once ${channel} confirms, the rest happens on its own, except the refund, which you make yourself.`}
        </DialogDescription>

        {mutation.isError && refusal !== null ? (
          <Alert
            tone={refusal === 'needs-ack' ? 'warning' : 'error'}
            title={
              refusal === 'needs-ack'
                ? 'This order is on the pack bench'
                : (inlineCode ? ORDER_CANCEL_INLINE_TITLES[inlineCode] : undefined) ??
                  'Could not cancel this order'
            }
            data-testid="order-cancel-error"
          >
            {readServerReason(mutation.error, 'Could not cancel this order.')}
          </Alert>
        ) : null}

        <form
          onSubmit={(event) => {
            void submit(event);
          }}
          className="order-hold-dialog__form"
          noValidate
        >
          <FormField
            name="reason"
            label="Reason"
            error={form.formState.errors.reason?.message}
            description={`For your team. ${channel} receives the reason code only, never your note.`}
          >
            <Select {...form.register('reason')} data-testid="order-cancel-reason">
              {OrderCancelReasonValues.map((value) => (
                <option key={value} value={value}>
                  {ORDER_CANCEL_REASON_LABELS[value]}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField
            name="note"
            label={reasonValue === 'other' ? 'Note' : 'Note (optional)'}
            error={form.formState.errors.note?.message}
            description="Anything the next person needs to know. Never buyer details."
          >
            <Textarea
              rows={2}
              maxLength={ORDER_CANCEL_NOTE_MAX_LENGTH}
              {...form.register('note')}
              data-testid="order-cancel-note"
            />
          </FormField>

          <div>
            <p className="dialog-section__head">What happens</p>
            <ul className="order-cancel-impact" data-testid="order-cancel-impact">
              <li className="order-cancel-impact__row" data-testid="order-cancel-impact-channel">
                <span className="order-cancel-impact__head">
                  <span className="order-cancel-impact__what">{sourceName ?? 'Sales channel'}</span>
                  <StatusBadge tone="info" compact>
                    Sent
                  </StatusBadge>
                </span>
                <span className="order-cancel-impact__how">
                  {`The order is marked as cancelled on ${channel}. If a channel has no cancel call, OpenLinker restores the stock only and tells you afterwards.`}
                </span>
              </li>
              <li className="order-cancel-impact__row" data-testid="order-cancel-impact-stock">
                <span className="order-cancel-impact__head">
                  <span className="order-cancel-impact__what">
                    Stock
                    {unitCount !== null ? (
                      <span className="order-cancel-impact__sub">{`${unitCount} unit${unitCount === 1 ? '' : 's'}`}</span>
                    ) : null}
                  </span>
                  <StatusBadge tone="info" compact>
                    Automatic
                  </StatusBadge>
                </span>
                <span className="order-cancel-impact__how">
                  Reserved units are released, open fulfilment work is cancelled and a shipping label
                  that was bought is voided where the carrier allows it.
                </span>
              </li>
              {invoiced ? (
                <li className="order-cancel-impact__row" data-testid="order-cancel-impact-invoice">
                  <span className="order-cancel-impact__head">
                    <span className="order-cancel-impact__what">Invoice</span>
                    <StatusBadge tone="warning" compact>
                      You review
                    </StatusBadge>
                  </span>
                  <span className="order-cancel-impact__how">
                    An issued invoice can not be withdrawn. OpenLinker opens a correction proposal for
                    you to review and confirm.
                  </span>
                </li>
              ) : null}
              <li className="order-cancel-impact__row" data-testid="order-cancel-impact-money">
                <span className="order-cancel-impact__head">
                  <span className="order-cancel-impact__what">
                    Money
                    {totalLabel ? (
                      <span className="order-cancel-impact__sub mono-text">{totalLabel}</span>
                    ) : null}
                  </span>
                  <StatusBadge tone="warning" compact>
                    Your action
                  </StatusBadge>
                </span>
                <span className="order-cancel-impact__how">
                  {`Not refunded by OpenLinker. Refund the buyer in ${channel} yourself. The payment keeps reading Paid until a refund is confirmed.`}
                </span>
              </li>
            </ul>
          </div>

          {needsAck ? (
            <Alert tone="warning" title="This order is on the pack bench" data-testid="order-cancel-ack-alert">
              Someone claimed this order at the pack bench and may already be picking it. Cancelling
              takes it off the bench.
              <label className="order-cancel-check">
                <input
                  type="checkbox"
                  data-testid="order-cancel-ack"
                  {...form.register('acknowledgeAcceptedWork')}
                />
                <span>I have told the packer to stop</span>
              </label>
            </Alert>
          ) : null}

          <DialogFooter>
            {keepButton('Keep order')}
            <Button
              type="submit"
              tone="danger"
              disabled={!canSubmit}
              data-testid="order-cancel-submit"
            >
              {mutation.isPending ? 'Cancelling…' : 'Cancel order'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
