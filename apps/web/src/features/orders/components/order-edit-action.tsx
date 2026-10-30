/**
 * Order Edit Action (#3544, mockup M1 `order`)
 *
 * The "Edit order" button for the detail page's `PageLayout.actions` slot, and the
 * dialog it opens.
 *
 * **The gate is admin AND `orders:write`, not `orders:write` alone**, the
 * `OrderCancelAction` rule: every edit route is `@Roles('admin')` while the
 * operator role holds `orders:write`, so the permission by itself renders a
 * button that 403s. A demo viewer is still shown the disabled control (#1615).
 *
 * Hidden for a terminal order (cancelled / delivered / refunded). A DISPATCHED
 * order keeps the button on purpose: its refusal says the parcel is on its way and
 * names the returns flow, where a missing button would explain nothing.
 *
 * @module apps/web/src/features/orders/components
 */
import { useState, type ReactElement } from 'react';

import { Button } from '../../../shared/ui/button';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { useIsAdmin, useWriteAccess } from '../../../shared/auth/use-permission';
import { DEMO_READ_ONLY_ACTION_MESSAGE } from '../../../shared/config/demo-mode';
import { useDemoMode } from '../../system';
import type { OrderEditsView } from '../api/order-edit.types';
import type { ParsedOrderSnapshot } from '../api/order-snapshot.schema';
import type { EditOrderOutput } from '../hooks/use-edit-order-mutation';
import type { OrderEditRemedyTarget } from '../lib/order-edit';
import { OrderEditDialog } from './order-edit-dialog';

export interface OrderEditActionProps {
  internalOrderId: string;
  orderNumber: string | null;
  sourceName: string | null;
  snapshot: ParsedOrderSnapshot;
  edits: OrderEditsView | null | undefined;
  /** The order is already packed: the server would refuse every edit, so say so on open. */
  packed: boolean;
  /** A holder already accepted or started work on this order (the soft gate). */
  acceptedWork: boolean;
  /** The parcel is on its way: only the discount can still be edited. */
  shipped?: boolean;
  /** The order is already in a terminal state, so no action is offered. */
  terminal: boolean;
  /** A change (an open cancel request) is already waiting for the channel. */
  amending: boolean;
  onSaved: (outputs: readonly EditOrderOutput[]) => void;
  onGoTo?: (target: OrderEditRemedyTarget) => void;
}

export function OrderEditAction({
  terminal,
  amending,
  packed,
  shipped = false,
  ...dialogProps
}: OrderEditActionProps): ReactElement | null {
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
          data-testid="order-edit-button"
          onClick={() => {
            setOpen(true);
          }}
        >
          Edit order
        </Button>
      </ReadOnlyLock>
      <OrderEditDialog
        open={open}
        onOpenChange={setOpen}
        predictedRefusal={packed ? 'ORDER_PACKED' : shipped ? 'ORDER_ALREADY_SHIPPED' : null}
        {...dialogProps}
      />
    </>
  );
}
