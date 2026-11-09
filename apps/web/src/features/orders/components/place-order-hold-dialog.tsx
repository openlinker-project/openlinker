/**
 * Place Order Hold Dialog (#2342)
 *
 * Collects the closed-vocabulary reason and an optional operator note, then
 * places the hold. Fully interactive at every width — a reason select plus a
 * note is not a "complex editor" under `frontend-ui-style-guide.md` § Responsive,
 * so it never shows the "open on a desktop screen to edit" affordance (the
 * `GenerateLabelForm` / `BulkDispatchDialog` precedent).
 *
 * The acting user is NEVER sent: the backend stamps it from the session, so a
 * caller cannot claim to be someone else.
 *
 * @module apps/web/src/features/orders/components
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, type ReactElement } from 'react';
import { useForm } from 'react-hook-form';

import { useMessages } from '../../../shared/i18n';
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
import { useToast } from '../../../shared/ui/toast-provider';
import { describeHoldWriteError } from '../lib/order-hold-errors';
import { HoldReasonValues, holdReasonLabel } from '../lib/order-hold.types';
import { usePlaceOrderHoldMutation } from '../hooks/use-place-order-hold-mutation';
import {
  HOLD_NOTE_MAX_LENGTH,
  createPlaceOrderHoldSchema,
  type PlaceOrderHoldFormValues,
  type PlaceOrderHoldSubmission,
} from './place-order-hold-dialog.schema';

export interface PlaceOrderHoldDialogProps {
  open: boolean;
  internalOrderId: string;
  onOpenChange: (open: boolean) => void;
}

export function PlaceOrderHoldDialog({
  open,
  internalOrderId,
  onOpenChange,
}: PlaceOrderHoldDialogProps): ReactElement {
  const { showToast } = useToast();
  const mutation = usePlaceOrderHoldMutation();
  const holds = useMessages('orders').holds;
  const copy = holds.placeDialog;
  const schema = useMemo(() => createPlaceOrderHoldSchema(holds.validation), [holds]);

  const form = useForm<PlaceOrderHoldFormValues, undefined, PlaceOrderHoldSubmission>({
    defaultValues: { reason: 'operator', note: '' },
    resolver: zodResolver(schema),
  });

  // Reset on every open so a dismissed draft never reappears against a
  // different order, and a previous failure's Alert does not outlive it.
  // `reset` is destructured so the dependency list is honest rather than
  // suppressed (the `AiProviderKeyDialog` precedent).
  const { reset: resetForm } = form;
  const { reset: resetMutation } = mutation;
  useEffect(() => {
    if (open) {
      resetForm({ reason: 'operator', note: '' });
      resetMutation();
    }
  }, [open, resetForm, resetMutation]);

  const submit = form.handleSubmit((values: PlaceOrderHoldSubmission): void => {
    const note = values.note?.trim();
    mutation.mutate(
      { internalOrderId, reason: values.reason, note: note ? note : undefined },
      {
        onSuccess: (result) => {
          // A hold cannot recall a carrier call already in flight (#2338
          // review). When the backend reports the overlap, say so — the
          // alternative is an operator seeing a hold badge and later a tracking
          // number with nothing anywhere connecting the two.
          if (result.dispatchInFlight === true) {
            showToast({
              tone: 'warning',
              description: copy.placedWhileDispatchingToast,
            });
          } else {
            showToast({ tone: 'success', description: copy.placedToast });
          }
          onOpenChange(false);
        },
        // The error renders in the dialog's own Alert rather than a toast: the
        // operator is still in the form and the remedy is usually to change
        // something in it.
      },
    );
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="order-hold-dialog">
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogDescription>{copy.description}</DialogDescription>

        {mutation.isError ? (
          <Alert tone="error">
            {describeHoldWriteError(mutation.error, copy.errorFallback)}
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
            label={copy.reasonLabel}
            error={form.formState.errors.reason?.message}
            description={copy.reasonDescription}
          >
            <Select {...form.register('reason')}>
              {HoldReasonValues.map((value) => (
                <option key={value} value={value}>
                  {holdReasonLabel(value)}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField
            name="note"
            label={copy.noteLabel}
            error={form.formState.errors.note?.message}
            description={copy.noteDescription}
          >
            <Textarea rows={3} maxLength={HOLD_NOTE_MAX_LENGTH} {...form.register('note')} />
          </FormField>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" tone="secondary" disabled={mutation.isPending}>
                {copy.cancel}
              </Button>
            </DialogClose>
            <Button type="submit" tone="primary" disabled={mutation.isPending}>
              {mutation.isPending ? copy.submitting : copy.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
