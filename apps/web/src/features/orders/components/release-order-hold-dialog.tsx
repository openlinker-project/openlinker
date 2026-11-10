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
import { useEffect, useMemo, type ReactElement, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';

import { renderRich, useMessages, type Messages, type ResolvedCopy } from '../../../shared/i18n';
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
import { describeProvisioningResume, holdReasonLabel } from '../lib/order-hold.types';
import { useReleaseOrderHoldMutation } from '../hooks/use-release-order-hold-mutation';
import { HOLD_NOTE_MAX_LENGTH } from './place-order-hold-dialog.schema';
import type { ReleaseOrderHoldFormValues } from './order-form.types';
import { buildReleaseOrderHoldSchema } from './release-order-hold-dialog.schema';

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

type ReleaseDialogCopy = ResolvedCopy<Messages['orders']>['holds']['releaseDialog'];

/** When the hold was placed and, when recorded, by whom. */
function renderPlacedAt(hold: OrderHold, copy: ReleaseDialogCopy): ReactNode {
  const actor = hold.placedByService ?? hold.placedByUserId;
  const time = (): ReactNode => <TimeDisplay iso={hold.placedAt} format="relative" />;
  if (!actor) return time();
  return renderRich(
    copy.placedAtBy,
    { time, actor: (text) => <span className="mono-text">{text}</span> },
    { actor }
  );
}

export function ReleaseOrderHoldDialog({
  open,
  hold,
  onOpenChange,
  onReleased,
}: ReleaseOrderHoldDialogProps): ReactElement {
  const { showToast } = useToast();
  const mutation = useReleaseOrderHoldMutation();
  const holds = useMessages('orders').holds;
  const copy = holds.releaseDialog;

  // §6.4: a note is mandatory when a USER releases a hold a SERVICE placed.
  //
  // `!= null`, not `!== null`: an ABSENT field (the #939 shape — OL serialises a
  // missing optional as JSON `null`, and a payload can omit it outright) was
  // read as "a service placed this". Requiring the note on an unreadable placer
  // is the safe direction; ASSERTING who placed it is not — see the description
  // below, which no longer says so.
  const placerUnknown = hold.placedByService == null && hold.placedByUserId == null;
  const noteRequired = hold.placedByService != null || placerUnknown;
  const schema = useMemo(
    () => buildReleaseOrderHoldSchema(noteRequired, holds.validation),
    [noteRequired, holds]
  );

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
          const resume = describeProvisioningResume(result.provisioningResume);
          showToast({ tone: resume.tone, description: resume.message });
          onReleased(result.provisioningResume);
          // Closed on every success, including a `failed` resume: the release
          // DID happen, so re-submitting would only answer 409.
          onOpenChange(false);
        },
      }
    );
  });

  const reasonLabel = holdReasonLabel(hold.reason);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="order-hold-dialog">
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogDescription>{copy.description}</DialogDescription>

        {mutation.isError ? (
          <Alert tone="error">{describeHoldWriteError(mutation.error)}</Alert>
        ) : null}

        <dl className="order-hold-dialog__summary">
          <dt>{copy.reasonLabel}</dt>
          <dd>{reasonLabel}</dd>
          <dt>{copy.placedLabel}</dt>
          <dd>{renderPlacedAt(hold, copy)}</dd>
          {hold.note ? (
            <>
              <dt>{copy.noteLabel}</dt>
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
            label={noteRequired ? copy.noteLabel : copy.noteOptionalLabel}
            error={form.formState.errors.note?.message}
            description={
              placerUnknown
                ? copy.noteDescriptionPlacerUnknown
                : noteRequired
                  ? copy.noteDescriptionRequired
                  : copy.noteDescriptionOptional
            }
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
