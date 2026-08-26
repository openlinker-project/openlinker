/**
 * Release Order Hold Dialog (#2342)
 *
 * Shows what is being released, collects the note when the domain requires one,
 * and reports what happened to the provisioning run the hold was suppressing.
 *
 * **A release is never reported as a flat success.** `provisioningResume`
 * (#2341) can say `failed`, which means the hold is gone AND the order is still
 * un-provisioned — with no scheduled task covering that one order. The dialog
 * hands the outcome up via `onReleased` so the panel can keep the remedy on
 * screen; the toast alone would scroll away.
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
import { Textarea } from '../../../shared/ui/textarea';
import { TimeDisplay } from '../../../shared/ui/time-display';
import { useToast } from '../../../shared/ui/toast-provider';
import type { OrderHold, ProvisioningResume } from '../api/orders.types';
import { describeHoldWriteError } from '../lib/order-hold-errors';
import { describeProvisioningResume, HOLD_REASON_COPY, isHoldReason } from '../lib/order-hold.types';
import { useReleaseOrderHoldMutation } from '../hooks/use-release-order-hold-mutation';
import { HOLD_NOTE_MAX_LENGTH } from './place-order-hold-dialog.schema';
import {
  buildReleaseOrderHoldSchema,
  type ReleaseOrderHoldFormValues,
} from './release-order-hold-dialog.schema';

export interface ReleaseOrderHoldDialogProps {
  open: boolean;
  /** The open hold. The dialog reads the placer from it to decide the note rule. */
  hold: OrderHold;
  onOpenChange: (open: boolean) => void;
  /**
   * Called once the release succeeded, with whatever the backend reported about
   * restarting provisioning. `undefined` on an API predating #2341.
   */
  onReleased: (resume: ProvisioningResume | undefined) => void;
}

export function ReleaseOrderHoldDialog({
  open,
  hold,
  onOpenChange,
  onReleased,
}: ReleaseOrderHoldDialogProps): ReactElement {
  const { showToast } = useToast();
  const mutation = useReleaseOrderHoldMutation();

  // §6.4: a note is mandatory when a USER releases a hold a SERVICE placed.
  const noteRequired = hold.placedByService !== null;
  const schema = useMemo(() => buildReleaseOrderHoldSchema(noteRequired), [noteRequired]);

  const form = useForm<ReleaseOrderHoldFormValues>({
    defaultValues: { note: '' },
    resolver: zodResolver(schema),
  });

  // `reset` destructured so the dependency list is honest rather than
  // suppressed (the `AiProviderKeyDialog` precedent). `hold.id` is in the list
  // because reopening against a DIFFERENT hold must clear the previous draft.
  const { reset: resetForm } = form;
  const { reset: resetMutation } = mutation;
  useEffect(() => {
    if (open) {
      resetForm({ note: '' });
      resetMutation();
    }
  }, [open, hold.id, resetForm, resetMutation]);

  const submit = form.handleSubmit((values: ReleaseOrderHoldFormValues): void => {
    const note = values.note?.trim();
    mutation.mutate(
      { internalOrderId: hold.internalOrderId, holdId: hold.id, note: note ? note : undefined },
      {
        onSuccess: (result) => {
          const copy = describeProvisioningResume(result.provisioningResume);
          showToast({ tone: copy.tone, description: copy.message });
          onReleased(result.provisioningResume);
          // Closed on every success, including a `failed` resume: the release
          // DID happen, so re-submitting would only answer 409.
          onOpenChange(false);
        },
      },
    );
  });

  const reasonLabel = isHoldReason(hold.reason) ? HOLD_REASON_COPY[hold.reason].label : hold.reason;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="order-hold-dialog">
        <DialogTitle>Release this hold</DialogTitle>
        <DialogDescription>
          OpenLinker starts sending this order to its destination again.
        </DialogDescription>

        {mutation.isError ? (
          <Alert tone="error">
            {describeHoldWriteError(mutation.error, 'Could not release this hold.')}
          </Alert>
        ) : null}

        <dl className="order-hold-dialog__summary">
          <dt>Reason</dt>
          <dd>{reasonLabel}</dd>
          <dt>Put on hold</dt>
          <dd>
            <TimeDisplay iso={hold.placedAt} format="relative" />
            {hold.placedByService ? (
              <>
                {' by '}
                <span className="mono-text">{hold.placedByService}</span>
              </>
            ) : hold.placedByUserId ? (
              <>
                {' by '}
                <span className="mono-text">{hold.placedByUserId}</span>
              </>
            ) : null}
          </dd>
          {hold.note ? (
            <>
              <dt>Note</dt>
              <dd>{hold.note}</dd>
            </>
          ) : null}
        </dl>

        <form
          onSubmit={(event) => {
            void submit(event);
          }}
          className="order-hold-dialog__form"
          noValidate
        >
          <FormField
            name="releaseNote"
            label={noteRequired ? 'Note' : 'Note (optional)'}
            error={form.formState.errors.note?.message}
            description={
              noteRequired
                ? 'OpenLinker put this order on hold by itself, so say why it is safe to release.'
                : 'Anything the next person needs to know. Never buyer details.'
            }
          >
            <Textarea rows={3} maxLength={HOLD_NOTE_MAX_LENGTH} {...form.register('note')} />
          </FormField>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" tone="secondary" disabled={mutation.isPending}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" tone="primary" disabled={mutation.isPending}>
              {mutation.isPending ? 'Releasing…' : 'Release hold'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
