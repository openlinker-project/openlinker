/**
 * OrderAddGiftAction (#3940, mockup M31 `order-gift-add`)
 *
 * The "Add gift" button for the order detail's action slot, and its dialog. It
 * is offered for every order that is still open: a parcel that is already closed
 * is not hidden, because the dialog says so in words where a missing button
 * would explain nothing. A cancelled or finished order has nothing to add to.
 * Read-only roles see the button locked, with the reason.
 *
 * @module apps/web/src/features/gifts/components
 */
import { useState, type ReactElement } from 'react';
import { useMessages } from '../../../shared/i18n';
import { Button } from '../../../shared/ui/button';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { useWriteAccess } from '../../../shared/auth/use-permission';
import { useDemoMode } from '../../system';
import { AddGiftDialog } from './add-gift-dialog';

export interface OrderAddGiftActionProps {
  internalOrderId: string;
  orderLabel: string;
  currency?: string;
  /** Cancelled, delivered or refunded: nothing to add to. */
  terminal: boolean;
  /** The parcel is packed or on its way. */
  parcelClosed: boolean;
  notReady?: boolean;
  hasSalesDocument: boolean;
  /** The connection issuing the sales document, once there is one. */
  documentConnectionId?: string | null;
  /** Controlled open state, so the order's attention banner can open the same dialog. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function OrderAddGiftAction({
  terminal,
  open: controlledOpen,
  onOpenChange,
  ...dialogProps
}: OrderAddGiftActionProps): ReactElement | null {
  const copy = useMessages('gifts');
  const demoMode = useDemoMode();
  const write = useWriteAccess('gifts:write', demoMode);
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = onOpenChange ?? setLocalOpen;
  if (terminal) return null;

  return (
    <>
      <ReadOnlyLock active={!write.canWrite} message={copy.order.readOnly}>
        <Button
          tone="secondary"
          disabled={!write.canWrite}
          onClick={() => setOpen(true)}
          data-testid="order-gift-add"
        >
          {copy.order.add}
        </Button>
      </ReadOnlyLock>
      {!write.canWrite ? (
        <p className="text-muted" role="note" data-testid="order-gift-readonly-notice">
          {copy.order.readOnlyNotice}
        </p>
      ) : null}
      {write.canWrite ? <AddGiftDialog open={open} onOpenChange={setOpen} {...dialogProps} /> : null}
    </>
  );
}
