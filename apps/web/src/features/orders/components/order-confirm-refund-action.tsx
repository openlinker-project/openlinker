/**
 * Order Confirm Refund Action (#3541, mockup M1 `cancel-done` header action)
 *
 * The "Confirm refund" button for the detail page's `PageLayout.actions` slot and
 * the dialog behind it. Offered once an order is cancelled, or a cancel is open
 * or confirmed, because that is when an operator owes the buyer money OpenLinker
 * does not move.
 *
 * Gated on `orders:write` alone: the refunds route is `@Roles('admin',
 * 'operator')` and the operator role holds `orders:write`, so unlike the cancel
 * action there is no admin-only gap to close. A demo viewer sees the disabled
 * control (#1615).
 *
 * @module apps/web/src/features/orders/components
 */
import { useState, type ReactElement } from 'react';

import { Button } from '../../../shared/ui/button';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { useWriteAccess } from '../../../shared/auth/use-permission';
import { DEMO_READ_ONLY_ACTION_MESSAGE } from '../../../shared/config/demo-mode';
import { useDemoMode } from '../../system';
import { ConfirmOrderRefundDialog } from './confirm-order-refund-dialog';

export interface OrderConfirmRefundActionProps {
  internalOrderId: string;
  currency: string | null;
  orderTotal: string | null;
  /** The order is cancelled, or has an open or confirmed cancel request. */
  visible: boolean;
}

export function OrderConfirmRefundAction({
  visible,
  ...dialogProps
}: OrderConfirmRefundActionProps): ReactElement | null {
  const demoMode = useDemoMode();
  const write = useWriteAccess('orders:write', demoMode);
  const [open, setOpen] = useState(false);

  if (!visible || !(write.canWrite || write.demoReadOnly)) return null;

  return (
    <>
      <ReadOnlyLock active={write.demoReadOnly} message={DEMO_READ_ONLY_ACTION_MESSAGE}>
        <Button
          tone="primary"
          disabled={write.demoReadOnly}
          data-testid="order-confirm-refund-button"
          onClick={() => {
            setOpen(true);
          }}
        >
          Confirm refund
        </Button>
      </ReadOnlyLock>
      <ConfirmOrderRefundDialog open={open} onOpenChange={setOpen} {...dialogProps} />
    </>
  );
}
