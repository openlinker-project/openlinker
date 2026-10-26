/**
 * Add a packer from the status page (#3457)
 *
 * The status page has no wizard step to return to, so adding a packer after
 * setup opens the same form step 2 uses, in a dialog. The one-time password
 * lives in the form's own state, so closing the dialog discards it.
 *
 * @module features/oms-onboarding/components
 */
import type { ReactElement } from 'react';

import { Button } from '../../../shared/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '../../../shared/ui/dialog';
import type { PackerSummary } from '../../users';
import { omsOnboardingCopy as COPY } from '../lib/oms-onboarding.copy';
import { PackerCreator } from './step-packers';

export interface AddPackerDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly packers: readonly PackerSummary[];
  readonly demoReadOnly: boolean;
}

export function AddPackerDialog({ open, onOpenChange, packers, demoReadOnly }: AddPackerDialogProps): ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-add-packer">
        <DialogTitle>{COPY.step2.addTitle}</DialogTitle>
        <DialogDescription>{COPY.status.addPackerDialogBody}</DialogDescription>
        <PackerCreator packers={packers} canWrite demoReadOnly={demoReadOnly} />
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" tone="secondary">
              {COPY.status.closeDialog}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
