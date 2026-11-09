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
import { useEffect, useMemo, type ReactElement } from 'react';
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
import { interpolate, useMessages, usePlural } from '../../../shared/i18n';
import { useCancelOrderMutation } from '../hooks/use-cancel-order-mutation';
import {
  classifyOrderCancelError,
  ORDER_CANCEL_NOTE_MAX_LENGTH,
  OrderCancelReasonValues,
  orderCancelInlineTitle,
  orderCancelReasonLabel,
  readOrderCancelErrorCode,
  readServerReason,
} from '../lib/order-cancel';
import {
  createCancelOrderSchema,
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
  const copy = useMessages('orders').cancelOrderDialog;
  const plural = usePlural();
  const schema = useMemo(() => createCancelOrderSchema(copy.validation), [copy.validation]);
  const mutation = useCancelOrderMutation();
  const form = useForm<CancelOrderFormValues, undefined, CancelOrderSubmission>({
    defaultValues: { reason: REASON_DEFAULT, note: '', acknowledgeAcceptedWork: false },
    resolver: zodResolver(schema),
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
  const channel = sourceName ?? copy.channelFallback;
  const refusal = mutation.isError ? classifyOrderCancelError(mutation.error) : null;
  const pending = mutation.data?.status === 'pending';
  const needsAck = acceptedWork || refusal === 'needs-ack';
  const acknowledged = form.watch('acknowledgeAcceptedWork') === true;
  const canSubmit = !mutation.isPending && (!needsAck || acknowledged);

  // mutateAsync, not mutate's per-call onSuccess: that callback is dropped when
  // the component unmounts, and a confirmed cancel makes the order terminal, which
  // unmounts this dialog (OrderCancelAction renders null) while the hook's own
  // invalidation is still awaited. The participant outcomes would be lost with it.
  const submit = form.handleSubmit(async (values: CancelOrderSubmission): Promise<void> => {
    const note = values.note?.trim();
    try {
      const result = await mutation.mutateAsync({
        internalOrderId,
        reason: values.reason,
        note: note ? note : undefined,
        // Sent only when ticked: an untouched box must not claim an
        // acknowledgement the operator never gave.
        acknowledgeAcceptedWork: values.acknowledgeAcceptedWork === true ? true : undefined,
      });
      onResult(result, values.reason);
      // `pending` keeps the dialog open on its progress view; a confirmed
      // cancel hands over to the page's result notice.
      if (result.status === 'cancelled') onOpenChange(false);
    } catch {
      // Surfaced through mutation.isError / classifyOrderCancelError below.
    }
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
            <DialogTitle>{interpolate(copy.progress.title, { order: title })}</DialogTitle>
            <DialogDescription>
              {interpolate(copy.progress.description, { channel })}
            </DialogDescription>
            <ol
              className="order-activity"
              aria-label={copy.progress.label}
              data-testid="order-cancel-progress"
            >
              <li className="order-activity__item">
                <span className="order-activity__dot order-activity__dot--warning" aria-hidden="true" />
                <div className="order-activity__body">
                  <p className="order-activity__title">{interpolate(copy.progress.askChannel, { channel })}</p>
                  <p className="order-activity__description">
                    <StatusBadge tone="warning" compact withDot>
                      {interpolate(copy.progress.waiting, { channel })}
                    </StatusBadge>
                  </p>
                </div>
              </li>
              <li className="order-activity__item">
                <span className="order-activity__dot order-activity__dot--default" aria-hidden="true" />
                <div className="order-activity__body">
                  <p className="order-activity__title">{copy.progress.connectedShops}</p>
                  <p className="order-activity__description">{copy.progress.afterConfirm}</p>
                </div>
              </li>
              <li className="order-activity__item">
                <span className="order-activity__dot order-activity__dot--default" aria-hidden="true" />
                <div className="order-activity__body">
                  <p className="order-activity__title">{copy.progress.releaseUnits}</p>
                  <p className="order-activity__description">{copy.progress.afterConfirm}</p>
                </div>
              </li>
              {invoiced ? (
                <li className="order-activity__item">
                  <span className="order-activity__dot order-activity__dot--default" aria-hidden="true" />
                  <div className="order-activity__body">
                    <p className="order-activity__title">{copy.progress.draftCorrection}</p>
                    <p className="order-activity__description">{copy.progress.draftCorrectionHint}</p>
                  </div>
                </li>
              ) : null}
              <li className="order-activity__item">
                <span className="order-activity__dot order-activity__dot--default" aria-hidden="true" />
                <div className="order-activity__body">
                  <p className="order-activity__title">{copy.progress.refund}</p>
                  <p className="order-activity__description">{copy.progress.refundHint}</p>
                </div>
              </li>
            </ol>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" tone="secondary" data-testid="order-cancel-progress-close">
                  {copy.progress.close}
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
            <DialogTitle>{copy.label.title}</DialogTitle>
            <DialogDescription data-testid="order-cancel-label-refusal">
              {readServerReason(mutation.error, copy.label.fallback)}
            </DialogDescription>
            <Alert tone="info" title={copy.label.whatToDo}>
              <ol className="order-cancel-list">
                <li>{copy.label.stepCancelShipment}</li>
                <li>{copy.label.stepCancelAgain}</li>
              </ol>
            </Alert>
            <p className="muted-text">{copy.label.note}</p>
            <DialogFooter>
              {keepButton(copy.keepOrder)}
              <Button
                type="button"
                tone="primary"
                data-testid="order-cancel-label-go-to-shipment"
                onClick={() => {
                  onOpenChange(false);
                  onGoToShipment?.();
                }}
              >
                {copy.label.goToShipment}
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
            <DialogTitle>{copy.shipped.title}</DialogTitle>
            <Alert
              tone="error"
              title={copy.shipped.alertTitle}
              data-testid="order-cancel-shipped-refusal"
            >
              {readServerReason(mutation.error, copy.shipped.fallback)}
            </Alert>
            <p className="dialog-section__head">{copy.shipped.insteadTitle}</p>
            <ol className="order-cancel-list">
              <li>{copy.shipped.stepReturn}</li>
              <li>{copy.shipped.stepRefund}</li>
              <li>{copy.shipped.stepInvoice}</li>
            </ol>
            <DialogFooter>{keepButton(copy.shipped.close)}</DialogFooter>
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
        <DialogTitle>{interpolate(copy.confirm.title, { order: title })}</DialogTitle>
        <DialogDescription>
          {interpolate(copy.confirm.description, { channel })}
        </DialogDescription>

        {mutation.isError && refusal !== null ? (
          <Alert
            tone={refusal === 'needs-ack' ? 'warning' : 'error'}
            title={
              refusal === 'needs-ack'
                ? copy.ack.title
                : (inlineCode ? orderCancelInlineTitle(inlineCode) : undefined) ??
                  copy.confirm.errorTitle
            }
            data-testid="order-cancel-error"
          >
            {readServerReason(mutation.error, copy.confirm.errorFallback)}
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
            label={copy.reason}
            error={form.formState.errors.reason?.message}
            description={interpolate(copy.reasonHint, { channel })}
          >
            <Select {...form.register('reason')} data-testid="order-cancel-reason">
              {OrderCancelReasonValues.map((value) => (
                <option key={value} value={value}>
                  {orderCancelReasonLabel(value)}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField
            name="note"
            label={reasonValue === 'other' ? copy.note : copy.noteOptional}
            error={form.formState.errors.note?.message}
            description={copy.noteHint}
          >
            <Textarea
              rows={2}
              maxLength={ORDER_CANCEL_NOTE_MAX_LENGTH}
              {...form.register('note')}
              data-testid="order-cancel-note"
            />
          </FormField>

          <div>
            <p className="dialog-section__head">{copy.impact.title}</p>
            <ul className="order-cancel-impact" data-testid="order-cancel-impact">
              <li className="order-cancel-impact__row" data-testid="order-cancel-impact-channel">
                <span className="order-cancel-impact__head">
                  <span className="order-cancel-impact__what">{sourceName ?? copy.impact.channelFallback}</span>
                  <StatusBadge tone="info" compact>
                    {copy.impact.channelStatus}
                  </StatusBadge>
                </span>
                <span className="order-cancel-impact__how">
                  {interpolate(copy.impact.channelBody, { channel })}
                </span>
              </li>
              <li className="order-cancel-impact__row" data-testid="order-cancel-impact-stock">
                <span className="order-cancel-impact__head">
                  <span className="order-cancel-impact__what">
                    {copy.impact.stock}
                    {unitCount !== null ? (
                      <span className="order-cancel-impact__sub">{plural(unitCount, copy.impact.units)}</span>
                    ) : null}
                  </span>
                  <StatusBadge tone="info" compact>
                    {copy.impact.stockStatus}
                  </StatusBadge>
                </span>
                <span className="order-cancel-impact__how">
                  {copy.impact.stockBody}
                </span>
              </li>
              {invoiced ? (
                <li className="order-cancel-impact__row" data-testid="order-cancel-impact-invoice">
                  <span className="order-cancel-impact__head">
                    <span className="order-cancel-impact__what">{copy.impact.invoice}</span>
                    <StatusBadge tone="warning" compact>
                      {copy.impact.invoiceStatus}
                    </StatusBadge>
                  </span>
                  <span className="order-cancel-impact__how">
                    {copy.impact.invoiceBody}
                  </span>
                </li>
              ) : null}
              <li className="order-cancel-impact__row" data-testid="order-cancel-impact-money">
                <span className="order-cancel-impact__head">
                  <span className="order-cancel-impact__what">
                    {copy.impact.money}
                    {totalLabel ? (
                      <span className="order-cancel-impact__sub mono-text">{totalLabel}</span>
                    ) : null}
                  </span>
                  <StatusBadge tone="warning" compact>
                    {copy.impact.moneyStatus}
                  </StatusBadge>
                </span>
                <span className="order-cancel-impact__how">
                  {interpolate(copy.impact.moneyBody, { channel })}
                </span>
              </li>
            </ul>
          </div>

          {needsAck ? (
            <Alert tone="warning" title={copy.ack.title} data-testid="order-cancel-ack-alert">
              {copy.ack.body}
              <label className="order-cancel-check">
                <input
                  type="checkbox"
                  data-testid="order-cancel-ack"
                  {...form.register('acknowledgeAcceptedWork')}
                />
                <span>{copy.ack.label}</span>
              </label>
            </Alert>
          ) : null}

          <DialogFooter>
            {keepButton(copy.keepOrder)}
            <Button
              type="submit"
              tone="danger"
              disabled={!canSubmit}
              data-testid="order-cancel-submit"
            >
              {mutation.isPending ? copy.cancelling : copy.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
