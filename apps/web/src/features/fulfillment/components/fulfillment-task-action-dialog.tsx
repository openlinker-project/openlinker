/**
 * Fulfilment-action dialog (#2411)
 *
 * One shell for the three actions that need a field before they can be sent:
 * `hold` (a reason plus an optional note), `release_hold` (an optional note,
 * against ONE specific hold), and `force_cancel` (a confirmation, because it is
 * irreversible and does not ask whoever holds the task).
 *
 * Kept as one component rather than three near-identical files: they differ
 * only in copy and which of two fields renders. The `mode` is a discriminated
 * prop supplied by the caller, never inferred from the task's state — this
 * surface derives nothing about legality (DESIGN §5.2).
 *
 * ## `note` and `releaseNote` are different fields and must not be swapped
 *
 * The action DTO carries both. `hold` records `note` ON the hold;
 * `release_hold` records `releaseNote` on the RELEASE. Sending the wrong one is
 * accepted with a 2xx and silently loses what the operator typed, so the
 * mapping is done here, once, in the open.
 *
 * The acting user is never sent — the backend stamps it from the session.
 *
 * @module apps/web/src/features/fulfillment/components
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
import { Textarea } from '../../../shared/ui/textarea';
import { HOLD_REASON_COPY, HoldReasonValues } from '../../orders';
import type { ApplyFulfillmentTaskActionRequest } from '../api/fulfillment.types';
import { describeFulfillmentActionError } from '../lib/fulfillment-conflict';
import {
  fulfillmentTaskActionSchema,
  type FulfillmentTaskActionFormValues,
  type FulfillmentTaskActionSubmission,
} from './fulfillment-task-action-dialog.schema';

export type FulfillmentTaskActionMode = 'hold' | 'release_hold' | 'force_cancel';

const COPY: Record<
  FulfillmentTaskActionMode,
  { title: string; description: string; confirm: string; failure: string }
> = {
  hold: {
    title: 'Put this fulfilment task on hold',
    description:
      'The task stops moving until someone releases the hold. The rest of the order is unaffected.',
    confirm: 'Put on hold',
    failure: 'Could not put this fulfilment task on hold.',
  },
  release_hold: {
    title: 'Release this hold',
    description: 'The fulfilment task can move again. Any other hold on it stays in place.',
    confirm: 'Release hold',
    failure: 'Could not release this hold.',
  },
  force_cancel: {
    title: 'Force-cancel this fulfilment task',
    description:
      'This cancels the task outright without asking whoever holds it, and cannot be undone. The order itself is not cancelled.',
    confirm: 'Force cancel',
    failure: 'Could not cancel this fulfilment task.',
  },
};

export interface FulfillmentTaskActionDialogProps {
  open: boolean;
  mode: FulfillmentTaskActionMode;
  /** Present for `release_hold` — which hold this dialog is about. */
  holdId?: string;
  submitting: boolean;
  error: unknown;
  onOpenChange: (open: boolean) => void;
  onSubmit: (body: Omit<ApplyFulfillmentTaskActionRequest, 'expectedVersion'>) => void;
}

export function FulfillmentTaskActionDialog({
  open,
  mode,
  holdId,
  submitting,
  error,
  onOpenChange,
  onSubmit,
}: FulfillmentTaskActionDialogProps): ReactElement {
  const copy = COPY[mode];

  const form = useForm<FulfillmentTaskActionFormValues, undefined, FulfillmentTaskActionSubmission>(
    {
      defaultValues: { reason: 'operator', note: '' },
      resolver: zodResolver(fulfillmentTaskActionSchema),
    }
  );

  // Reset on every open so a dismissed draft never reappears against a
  // different task, and a previous failure's Alert does not outlive it.
  const { reset: resetForm } = form;
  useEffect(() => {
    if (open) resetForm({ reason: 'operator', note: '' });
  }, [open, mode, holdId, resetForm]);

  const submit = form.handleSubmit((values: FulfillmentTaskActionSubmission): void => {
    const note = values.note?.trim();
    if (mode === 'hold') {
      onSubmit({ holdReason: values.reason, note: note ? note : undefined });
      return;
    }
    if (mode === 'release_hold') {
      // `releaseNote`, NOT `note` — see the module docblock.
      onSubmit({ holdId, releaseNote: note ? note : undefined });
      return;
    }
    // `cancellationReason` is deliberately not collected: the API defaults it to
    // `operator_forced`, which is exactly what this control means. Asking for a
    // value that has one correct answer is a question, not information.
    onSubmit({});
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="fulfilment-task-dialog">
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogDescription>{copy.description}</DialogDescription>

        {error ? (
          <Alert tone="error">{describeFulfillmentActionError(error, copy.failure)}</Alert>
        ) : null}

        <form
          onSubmit={(event) => {
            void submit(event);
          }}
          className="fulfilment-task-dialog__form"
          noValidate
        >
          {mode === 'hold' ? (
            <FormField
              name="reason"
              label="Reason"
              error={form.formState.errors.reason?.message}
              description="Everyone who looks at this fulfilment task later sees the reason you choose."
            >
              <Select {...form.register('reason')}>
                {HoldReasonValues.map((value) => (
                  <option key={value} value={value}>
                    {HOLD_REASON_COPY[value].label}
                  </option>
                ))}
              </Select>
            </FormField>
          ) : null}

          {mode === 'force_cancel' ? null : (
            <FormField
              name="note"
              label="Note (optional)"
              error={form.formState.errors.note?.message}
            >
              <Textarea rows={3} {...form.register('note')} />
            </FormField>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button tone="secondary" disabled={submitting}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              tone={mode === 'force_cancel' ? 'danger' : 'primary'}
              disabled={submitting}
            >
              {submitting ? 'Working…' : copy.confirm}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
