/**
 * Authorize Return Dialog (#3078/#3083)
 *
 * A pure confirm — `POST /returns/:returnId/authorize` takes nothing beyond
 * the return id (returns spec §5, `AuthorizeReturnResult` carries no
 * operator input), so there is no form here, unlike the match and record
 * writes.
 *
 * **A source-ingested return should never reach this dialog** — the
 * worklist's "Waiting for your OK" group is already filtered to
 * `origin === 'operator_authored' && authorizedAt === null` (#3081), so the
 * 409 `source-ingested` refusal is unreachable from that entry point. It is
 * still handled here, defensively, because this component is exported from
 * the feature barrel and nothing prevents a later caller (the return detail
 * page's own approve action, per the reviewed mockup) from opening it
 * against a return this dialog cannot verify.
 *
 * **Both `'authorized'` and `'already-authorized'` are SUCCESS outcomes**
 * (`AUTHORIZE_RETURN_OUTCOME_VALUES`) — the write is idempotent, so a lost
 * race against a concurrent approval closes the dialog exactly as a fresh
 * approval does, with no special-cased messaging.
 *
 * Removing the row from the pending-approval group (#3083's acceptance
 * criterion) needs no code here: `useAuthorizeReturnMutation`'s own
 * `onSettled` invalidates `returnsQueryKeys.all`, so the worklist's
 * `bucket: 'attributed'` scan refetches and the now-approved return no
 * longer matches `authorizedAt === null`.
 *
 * @module apps/web/src/features/returns/components
 */
import type { ReactElement } from 'react';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '../../../shared/ui/dialog';
import { useAuthorizeReturnMutation } from '../hooks/use-authorize-return-mutation';
import { isSourceIngestedAuthorizeRefusal } from '../lib/authorize-error';
import { AUTHORIZE_RETURN_DIALOG_COPY as COPY } from '../lib/authorize-return-dialog.copy';

interface AuthorizeReturnDialogProps {
  returnId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called once the return is confirmed authorized — including an idempotent repeat. */
  onAuthorized?: () => void;
}

export function AuthorizeReturnDialog({
  returnId,
  open,
  onOpenChange,
  onAuthorized,
}: AuthorizeReturnDialogProps): ReactElement {
  const mutation = useAuthorizeReturnMutation(returnId);

  const refused = mutation.isError && isSourceIngestedAuthorizeRefusal(mutation.error);

  function handleConfirm(): void {
    if (mutation.isPending) return;
    mutation.mutate(undefined, {
      onSuccess: () => {
        onOpenChange(false);
        onAuthorized?.();
      },
      // A refused attempt stays open — `refused` above renders the distinct
      // explanation in place of the confirm form.
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!mutation.isPending) onOpenChange(next);
      }}
    >
      <DialogContent>
        {refused ? (
          <>
            <DialogTitle>{COPY.refusedTitle}</DialogTitle>
            <DialogDescription>{COPY.refusedBody}</DialogDescription>
            <DialogFooter>
              <Button
                onClick={() => {
                  onOpenChange(false);
                }}
              >
                {COPY.refusedAcknowledge}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogTitle>{COPY.title}</DialogTitle>
            <DialogDescription>{COPY.description}</DialogDescription>

            {mutation.isError ? <Alert tone="error">{COPY.genericError}</Alert> : null}

            <DialogFooter>
              <Button
                type="button"
                tone="secondary"
                disabled={mutation.isPending}
                onClick={() => {
                  onOpenChange(false);
                }}
              >
                {COPY.cancel}
              </Button>
              <Button type="button" disabled={mutation.isPending} onClick={handleConfirm}>
                {mutation.isPending ? COPY.confirming : COPY.confirm}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
