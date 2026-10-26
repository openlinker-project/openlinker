/**
 * Bulk Cancel Dialog (#3619, mockup M3 `bulk`, decision D38)
 *
 * Confirm then report. The form reuses the single-order cancel dialog's reason
 * vocabulary and labels (`lib/order-cancel.ts`, D37) and its accepted-work
 * acknowledgement. The result is one row per order - cancelled, waiting for the
 * channel, cancelled with a correction proposal, refused with the server's own
 * reason and code, or failed - never all-or-nothing: the backend answers 200
 * with per-row outcomes, so only a request-level failure shows as an error.
 *
 * @module apps/web/src/features/orders/components
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState, type ReactElement } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';

import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '../../../shared/ui/dialog';
import { FormField } from '../../../shared/ui/form-field';
import { Select } from '../../../shared/ui/select';
import { Textarea } from '../../../shared/ui/textarea';
import type { BulkCancelOrdersResult } from '../api/order-bulk-actions.types';
import { useBulkCancelOrdersMutation } from '../hooks/use-bulk-order-actions';
import { BULK_ACTIONS_COPY, BULK_CANCEL_ROW } from '../lib/bulk-order-actions.copy';
import {
  ORDER_CANCEL_NOTE_MAX_LENGTH,
  ORDER_CANCEL_REASON_LABELS,
  OrderCancelReasonValues,
  readServerReason,
} from '../lib/order-cancel';
import { BulkResultRows, type BulkResultRow } from './bulk-result-rows';
import {
  bulkCancelSchema,
  type BulkCancelFormValues,
  type BulkCancelSubmission,
} from './bulk-cancel-dialog.schema';

const COPY = BULK_ACTIONS_COPY.cancel;
const DEFAULTS: BulkCancelFormValues = { reason: 'buyer-request', note: '', acknowledgeAcceptedWork: false };

export interface BulkCancelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderIds: readonly string[];
  /** Called once a result is shown, so the page can clear its selection. */
  onComplete?: () => void;
}

export function toCancelRows(result: BulkCancelOrdersResult): BulkResultRow[] {
  return result.results.map((row) => {
    const view = BULK_CANCEL_ROW[row.outcome];
    const detail = [row.reason, row.code ? `(${row.code})` : null].filter(Boolean).join(' ') || null;
    return {
      orderId: row.orderId,
      tone: view.tone,
      label: view.label,
      detail,
      extra:
        row.outcome === 'correction-proposed' ? (
          <Link
            className="bulk-dispatch__link"
            to={`/orders/${encodeURIComponent(row.orderId)}`}
            data-testid="orders-bulk-cancel-correction-link"
          >
            {COPY.correctionLink}
          </Link>
        ) : null,
    };
  });
}

export function BulkCancelDialog({
  open,
  onOpenChange,
  orderIds,
  onComplete,
}: BulkCancelDialogProps): ReactElement {
  const mutation = useBulkCancelOrdersMutation();
  const [result, setResult] = useState<BulkCancelOrdersResult | null>(null);
  const form = useForm<BulkCancelFormValues, undefined, BulkCancelSubmission>({
    defaultValues: DEFAULTS,
    resolver: zodResolver(bulkCancelSchema),
  });
  const { reset: resetForm } = form;
  const { reset: resetMutation } = mutation;

  useEffect(() => {
    if (open) {
      resetForm(DEFAULTS);
      resetMutation();
      setResult(null);
    }
  }, [open, resetForm, resetMutation]);

  const reasonValue = form.watch('reason');
  const submit = form.handleSubmit((values: BulkCancelSubmission): void => {
    const note = values.note?.trim();
    mutation.mutate(
      {
        orderIds: [...orderIds],
        reason: values.reason,
        note: note ? note : undefined,
        acknowledgeAcceptedWork: values.acknowledgeAcceptedWork === true ? true : undefined,
      },
      {
        onSuccess: (data) => {
          setResult(data);
          onComplete?.();
        },
      },
    );
  });

  if (result !== null) {
    const done = result.cancelled + result.pending + result.correctionProposed;
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="bulk-dispatch" data-testid="orders-bulk-cancel-dialog">
          <DialogTitle>{COPY.resultTitle}</DialogTitle>
          <DialogDescription data-testid="orders-bulk-cancel-summary">
            <strong>{COPY.resultSummary(done, result.total)}</strong>
            {result.refused > 0 ? ` · ${result.refused} refused` : ''}
            {result.failed > 0 ? ` · ${result.failed} failed` : ''}
          </DialogDescription>
          <BulkResultRows rows={toCancelRows(result)} testId="orders-bulk-cancel-results" />
          <DialogFooter>
            <Button
              tone="primary"
              data-testid="orders-bulk-cancel-close"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="order-hold-dialog" data-testid="orders-bulk-cancel-dialog">
        <DialogTitle>{COPY.title(orderIds.length)}</DialogTitle>
        <DialogDescription>{COPY.description}</DialogDescription>

        {mutation.isError ? (
          <Alert tone="error" title={COPY.requestError} data-testid="orders-bulk-cancel-error">
            {readServerReason(mutation.error, COPY.requestError)}
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
            label={COPY.reasonLabel}
            error={form.formState.errors.reason?.message}
            description={COPY.reasonHelp}
          >
            <Select {...form.register('reason')} data-testid="orders-bulk-cancel-reason">
              {OrderCancelReasonValues.map((value) => (
                <option key={value} value={value}>
                  {ORDER_CANCEL_REASON_LABELS[value]}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField
            name="note"
            label={reasonValue === 'other' ? COPY.noteLabel : COPY.noteOptionalLabel}
            error={form.formState.errors.note?.message}
            description={COPY.noteHelp}
          >
            <Textarea
              rows={2}
              maxLength={ORDER_CANCEL_NOTE_MAX_LENGTH}
              {...form.register('note')}
              data-testid="orders-bulk-cancel-note"
            />
          </FormField>

          <label className="order-cancel-check">
            <input
              type="checkbox"
              data-testid="orders-bulk-cancel-ack"
              {...form.register('acknowledgeAcceptedWork')}
            />
            <span>{COPY.ackLabel}</span>
          </label>
          <p className="muted-text">{COPY.ackHelp}</p>

          <DialogFooter>
            <Button
              type="button"
              tone="secondary"
              data-testid="orders-bulk-cancel-keep"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              {COPY.keep}
            </Button>
            <Button
              type="submit"
              tone="danger"
              disabled={mutation.isPending}
              data-testid="orders-bulk-cancel-submit"
            >
              {mutation.isPending ? COPY.submitting : COPY.submit(orderIds.length)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
