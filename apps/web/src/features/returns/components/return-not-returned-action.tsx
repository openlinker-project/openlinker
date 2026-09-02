/**
 * Return "Mark as not returned" Action (#2380)
 *
 * Records that a line's parcel is not coming (returns spec § 5.2).
 *
 * **Always an operator act, never a timeout** — which is why it is a button
 * behind a confirm rather than anything OpenLinker concludes on its own. A
 * parcel that has not arrived is not the same fact as a parcel that is not
 * coming, and only a human is in a position to assert the second.
 *
 * **Named for what it does, not for the spec's phrasing.** § 5.2 calls it
 * *"Mark remainder not returned"*, but the shipped model refuses a partially
 * received line: custody is single-valued and there is no counter for a
 * shortfall to move into. A label naming the remainder would promise a write
 * that gets refused, discovered by clicking. Where units did arrive this
 * renders the reason in place of the control instead — an unexplained absence
 * reads as a missing feature, and the shortfall really is still visible.
 *
 * @module apps/web/src/features/returns/components
 */
import { useState, type FormEvent, type ReactElement } from 'react';

import { Button } from '../../../shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '../../../shared/ui/dialog';
import { FormField } from '../../../shared/ui/form-field';
import { Textarea } from '../../../shared/ui/textarea';
import { RETURN_NOT_RETURNED_COPY } from '../lib/return-custody.copy';
import { canMarkNotReturned } from '../lib/return-line-quantities';
import type { ReturnLine } from '../api/returns.types';

interface ReturnNotReturnedActionProps {
  line: ReturnLine;
  pending: boolean;
  onConfirm: (input: { note?: string }) => void;
}

export function ReturnNotReturnedAction({
  line,
  pending,
  onConfirm,
}: ReturnNotReturnedActionProps): ReactElement | null {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');

  // A finished line has nothing to write off and no explanation to give — the
  // hint below is about the ONE case an operator would otherwise expect the
  // action in, not about every line that lacks it.
  if (!canMarkNotReturned(line)) {
    return line.quantityReceived > 0 && line.quantityReceived < line.quantityAdvised ? (
      <p className="returns-line-hint text-muted">
        {RETURN_NOT_RETURNED_COPY.partiallyReceivedHint}
      </p>
    ) : null;
  }

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    onConfirm({ note });
  };

  return (
    <>
      <Button onClick={() => setOpen(true)} tone="secondary" type="button">
        {RETURN_NOT_RETURNED_COPY.action}
      </Button>

      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent>
          <form noValidate onSubmit={submit}>
            <DialogTitle>{RETURN_NOT_RETURNED_COPY.confirmTitle}</DialogTitle>
            <DialogDescription>{RETURN_NOT_RETURNED_COPY.confirmBody}</DialogDescription>

            <FormField label={RETURN_NOT_RETURNED_COPY.noteLabel} name="not-returned-note">
              <Textarea
                onChange={(event) => setNote(event.target.value)}
                placeholder={RETURN_NOT_RETURNED_COPY.notePlaceholder}
                rows={2}
                value={note}
              />
            </FormField>

            <DialogFooter>
              <Button disabled={pending} type="submit">
                {pending ? RETURN_NOT_RETURNED_COPY.pending : RETURN_NOT_RETURNED_COPY.confirm}
              </Button>
              <Button
                disabled={pending}
                onClick={() => setOpen(false)}
                tone="secondary"
                type="button"
              >
                {RETURN_NOT_RETURNED_COPY.cancel}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
