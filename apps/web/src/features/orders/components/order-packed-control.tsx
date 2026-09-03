/**
 * Order Packed Control
 *
 * The mark/unmark affordance for the operator "packed" fact (#2288). The list
 * displays and the DETAIL page acts (#2081 rule 3), so this is the only place
 * the fact is written.
 *
 * It deliberately does NOT live in `OrderShipmentPanel`: that panel renders only
 * when a connection declares `ShippingProviderManager`, and packing is a fact
 * about every order — including one the shop fulfils itself. Hosting it there
 * would have hidden the control for exactly the orders whose packing nobody else
 * tracks. Staying out of that panel also leaves its #1615/#1826
 * `usePermission('shipments:write')` doctrine untouched.
 *
 * Gating mirrors the orders list's per-row Retry (`orders-list-page.tsx`):
 * `useWriteAccess` hides the affordance from a viewer entirely, and renders it
 * visible-but-disabled under a `ReadOnlyLock` tooltip for a demo viewer — a demo
 * visitor should see that the action exists, a viewer should not be shown one
 * they can never use. The packed FACT is read-only information, so it renders
 * for everyone; only the button is gated.
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactElement } from 'react';
import { Button } from '../../../shared/ui/button';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { TimeDisplay } from '../../../shared/ui/time-display';
import { useToast } from '../../../shared/ui/toast-provider';
import { useWriteAccess } from '../../../shared/auth/use-permission';
import { DEMO_READ_ONLY_ACTION_MESSAGE } from '../../../shared/config/demo-mode';
import { useDemoMode } from '../../system';
import { useMarkPackedMutation } from '../hooks/use-mark-packed-mutation';

export interface OrderPackedControlProps {
  internalOrderId: string;
  packedAt: string | null | undefined;
  packedByUserId: string | null | undefined;
}

export function OrderPackedControl({
  internalOrderId,
  packedAt,
  packedByUserId,
}: OrderPackedControlProps): ReactElement {
  const { showToast } = useToast();
  const demoMode = useDemoMode();
  const packWrite = useWriteAccess('orders:write', demoMode);
  const markPacked = useMarkPackedMutation();

  const packed = Boolean(packedAt);

  const handleToggle = (): void => {
    markPacked.mutate(
      { internalOrderId, packed: !packed },
      {
        onSuccess: () => {
          showToast({
            tone: 'success',
            description: packed ? 'Packed mark cleared.' : 'Order marked packed.',
          });
        },
        onError: (error: Error) => {
          showToast({
            tone: 'error',
            description: error.message || 'Could not update the packed mark.',
          });
        },
      },
    );
  };

  const buttonLabel = markPacked.isPending
    ? packed
      ? 'Clearing…'
      : 'Marking…'
    : packed
      ? 'Undo'
      : 'Mark packed';

  return (
    <section className="detail-section">
      <h3 className="detail-section__title">Packing</h3>
      <div className="ds-row order-packed-control">
        {packedAt ? (
          <span className="orders-packed-state">
            {/* Glyph + word, never colour alone (#2081). */}
            <span className="orders-packed-tick__mark" aria-hidden="true">
              ✓
            </span>{' '}
            Packed <TimeDisplay iso={packedAt} format="relative" />
            {packedByUserId ? (
              <>
                {' '}
                by <span className="mono-text">{packedByUserId}</span>
              </>
            ) : null}
          </span>
        ) : (
          <span className="text-muted">Not packed yet.</span>
        )}
        {packWrite.visible ? (
          <ReadOnlyLock active={packWrite.demoReadOnly} message={DEMO_READ_ONLY_ACTION_MESSAGE}>
            <Button
              tone={packed ? 'ghost' : 'primary'}
              className="button--sm"
              disabled={markPacked.isPending || packWrite.demoReadOnly}
              onClick={handleToggle}
            >
              {buttonLabel}
            </Button>
          </ReadOnlyLock>
        ) : null}
      </div>
    </section>
  );
}
