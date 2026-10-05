/**
 * Stop packing dialog (#3457)
 *
 * Says the three things a stop does and does not do: new orders go back to
 * the product master, work already on Fulfilment stays there, and the stock
 * setup is kept so a restart is one click.
 *
 * `data-state="dialog-stop-confirm"` sits on an inner wrapper rather than on
 * the dialog content, because Radix owns `data-state` on its Content element
 * ("open" / "closed") and would overwrite the mockup's value.
 *
 * @module features/oms-onboarding/components
 */
import type { ReactElement } from 'react';

import { Button } from '../../../shared/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '../../../shared/ui/dialog';
import { omsOnboardingCopy as COPY } from '../lib/oms-onboarding.copy';

export interface StopPackingDialogProps {
  readonly open: boolean;
  readonly masterNames: string;
  readonly parcelsOnFulfilment: number;
  readonly stopping: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfirm: () => void;
}

export function StopPackingDialog(props: StopPackingDialogProps): ReactElement {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <div data-testid="dialog-stop-packing" data-state="dialog-stop-confirm">
          <DialogTitle>{COPY.stopDialog.title}</DialogTitle>
          <DialogDescription>{COPY.stopDialog.bodyNewOrders(props.masterNames)}</DialogDescription>
          <p>{COPY.stopDialog.bodyExisting(props.parcelsOnFulfilment)}</p>
          <p>{COPY.stopDialog.bodyKept}</p>
          <DialogFooter>
            <Button
              type="button"
              tone="secondary"
              data-testid="btn-close-dialog"
              onClick={() => props.onOpenChange(false)}
            >
              {COPY.stopDialog.cancel}
            </Button>
            <Button
              type="button"
              tone="danger"
              data-testid="btn-stop-now"
              disabled={props.stopping}
              onClick={props.onConfirm}
            >
              {props.stopping ? COPY.stopDialog.stopping : COPY.stopDialog.confirm}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
