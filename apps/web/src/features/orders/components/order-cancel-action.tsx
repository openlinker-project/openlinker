/**
 * Order Cancel Action (#3541, mockup M1 `order`)
 *
 * The "Cancel order" button for the detail page's `PageLayout.actions` slot, and
 * the dialog it opens.
 *
 * **The gate is admin AND `orders:write`, not `orders:write` alone**, the
 * `OrderHoldPanel` rule: both cancel routes are `@Roles('admin')`, and
 * `ROLE_PERMISSIONS.operator` holds `orders:write`, so gating on the permission
 * by itself renders a button that 403s. A demo viewer is still shown the
 * disabled control (#1615).
 *
 * Hidden for a terminal order (cancelled / delivered / refunded). A DISPATCHED
 * order keeps the button on purpose: its refusal explains where the remedy is
 * (a return), where a missing button would explain nothing.
 *
 * @module apps/web/src/features/orders/components
 */
import { useState, type ReactElement } from 'react';

import { Button } from '../../../shared/ui/button';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { useIsAdmin, useWriteAccess } from '../../../shared/auth/use-permission';
import { DEMO_READ_ONLY_ACTION_MESSAGE } from '../../../shared/config/demo-mode';
import { useDemoMode } from '../../system';
import type { CancelOrderResult, OrderCancelReason } from '../api/order-cancel.types';
import { CancelOrderDialog } from './cancel-order-dialog';

export interface OrderCancelActionProps {
  internalOrderId: string;
  orderNumber: string | null;
  sourceName: string | null;
  unitCount: number | null;
  totalLabel: string | null;
  invoiced: boolean;
  acceptedWork: boolean;
  /** The order is already in a terminal state, so no action is offered. */
  terminal: boolean;
  /** A change (an open cancel request) is already waiting for the channel. */
  amending: boolean;
  onResult: (result: CancelOrderResult, reason: OrderCancelReason) => void;
  onGoToShipment?: () => void;
}

export function OrderCancelAction({
  terminal,
  amending,
  ...dialogProps
}: OrderCancelActionProps): ReactElement | null {
  const demoMode = useDemoMode();
  const write = useWriteAccess('orders:write', demoMode);
  const isAdmin = useIsAdmin();
  const canAct = (write.canWrite && isAdmin) || write.demoReadOnly;
  const [open, setOpen] = useState(false);

  if (terminal || !canAct) return null;

  return (
    <>
      <ReadOnlyLock active={write.demoReadOnly} message={DEMO_READ_ONLY_ACTION_MESSAGE}>
        <Button
          tone="secondary"
          disabled={write.demoReadOnly || amending}
          title={amending ? 'A change to this order is already waiting for the channel.' : undefined}
          data-testid="order-cancel-button"
          onClick={() => {
            setOpen(true);
          }}
        >
          Cancel order
        </Button>
      </ReadOnlyLock>
      <CancelOrderDialog open={open} onOpenChange={setOpen} {...dialogProps} />
    </>
  );
}
