/**
 * Order Hold Panel (#2342)
 *
 * The detail-page surface for order holds: the open hold, the full history, and
 * the place/release actions. The list DISPLAYS and the detail page ACTS
 * (#2081 rule 3) — the same split `OrderPackedControl` follows, which is also
 * where the write-affordance gating pattern comes from.
 *
 * **The gate is admin AND `orders:write`, not `orders:write` alone.**
 * `ROLE_PERMISSIONS.operator` includes `orders:write`, but both hold routes are
 * `@Roles('admin')` — so gating on the permission by itself renders a button
 * that 403s. A non-admin sees the hold and its history and no action, which is
 * the issue's own acceptance criterion.
 *
 * The hold FACT is read-only information and renders for everyone; only the
 * buttons are gated.
 *
 * @module apps/web/src/features/orders/components
 */
import { useState, type ReactElement } from 'react';

import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { TimeDisplay } from '../../../shared/ui/time-display';
import { useIsAdmin, useWriteAccess } from '../../../shared/auth/use-permission';
import { DEMO_READ_ONLY_ACTION_MESSAGE } from '../../../shared/config/demo-mode';
import { useDemoMode } from '../../system';
import type { OrderHold, ProvisioningResume } from '../api/orders.types';
import { HOLD_REASON_COPY, isHoldReason } from '../lib/order-hold.types';
import { PlaceOrderHoldDialog } from './place-order-hold-dialog';
import { ReleaseOrderHoldDialog } from './release-order-hold-dialog';

export interface OrderHoldPanelProps {
  internalOrderId: string;
  /** The open hold, or null/undefined when the order is not held. */
  activeHold: OrderHold | null | undefined;
  /** Every hold this order has carried. Absent on a pre-#2341 payload. */
  holdHistory: OrderHold[] | null | undefined;
}

function holdReasonLabelOf(hold: OrderHold): string {
  return isHoldReason(hold.reason) ? HOLD_REASON_COPY[hold.reason].label : hold.reason;
}

function placedBy(hold: OrderHold): ReactElement | null {
  const actor = hold.placedByService ?? hold.placedByUserId;
  if (!actor) return null;
  return (
    <>
      {' by '}
      <span className="mono-text">{actor}</span>
    </>
  );
}

export function OrderHoldPanel({
  internalOrderId,
  activeHold,
  holdHistory,
}: OrderHoldPanelProps): ReactElement {
  const demoMode = useDemoMode();
  const write = useWriteAccess('orders:write', demoMode);
  // `useIsAdmin`, never an inline `role === 'admin'`: `role` is typed `string`,
  // so a typo would compile and silently hide the control from everyone.
  const isAdmin = useIsAdmin();
  // A demo viewer is deliberately still shown the disabled control (#1615); an
  // ordinary operator, who holds `orders:write` but is refused by the route, is
  // not shown an action they can never complete.
  const canAct = (write.canWrite && isAdmin) || write.demoReadOnly;

  const [placeOpen, setPlaceOpen] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);
  /**
   * Session-local, and deliberately so: `provisioningResume` is returned once by
   * the release response and persisted by nothing, so this notice is gone on
   * reload or navigation. Calling it persistent would claim a durability the UI
   * cannot deliver. The toast is the primary signal; this keeps the remedy on
   * screen while the operator acts on it.
   */
  const [resumeFailure, setResumeFailure] = useState(false);

  const released = (holdHistory ?? []).filter((hold) => hold.releasedAt !== null);

  const handleReleased = (resume: ProvisioningResume | undefined): void => {
    setResumeFailure(resume?.status === 'failed');
  };

  return (
    <section className="detail-section">
      <h3 className="detail-section__title">Hold</h3>

      {resumeFailure ? (
        <Alert tone="warning">
          The hold was released, but this order did not start moving again. Use{' '}
          <strong>Retry</strong> on its destination below to send it on.
        </Alert>
      ) : null}

      <div className="ds-row order-hold-panel">
        {activeHold ? (
          <span className="order-hold-panel__state">
            <StatusBadge tone="warning" withDot compact>
              {`On hold — ${holdReasonLabelOf(activeHold)}`}
            </StatusBadge>{' '}
            since <TimeDisplay iso={activeHold.placedAt} format="relative" />
            {placedBy(activeHold)}
            {activeHold.note ? (
              <span className="order-hold-panel__note"> — {activeHold.note}</span>
            ) : null}
          </span>
        ) : (
          <span className="text-muted">Not on hold.</span>
        )}

        {canAct ? (
          <ReadOnlyLock active={write.demoReadOnly} message={DEMO_READ_ONLY_ACTION_MESSAGE}>
            <Button
              tone={activeHold ? 'primary' : 'secondary'}
              className="button--sm"
              disabled={write.demoReadOnly}
              onClick={() => (activeHold ? setReleaseOpen(true) : setPlaceOpen(true))}
            >
              {activeHold ? 'Release hold' : 'Put on hold'}
            </Button>
          </ReadOnlyLock>
        ) : null}
      </div>

      {released.length > 0 ? (
        <ol className="order-hold-panel__history">
          {released.map((hold) => (
            <li key={hold.id} className="order-hold-panel__history-item">
              <span className="text-muted">
                {holdReasonLabelOf(hold)} · held{' '}
                <TimeDisplay iso={hold.placedAt} format="relative" />
                {placedBy(hold)}, released{' '}
                {hold.releasedAt ? <TimeDisplay iso={hold.releasedAt} format="relative" /> : null}
                {hold.releasedByUserId ? (
                  <>
                    {' by '}
                    <span className="mono-text">{hold.releasedByUserId}</span>
                  </>
                ) : null}
                {hold.releaseNote ? ` — ${hold.releaseNote}` : ''}
              </span>
            </li>
          ))}
        </ol>
      ) : null}

      <PlaceOrderHoldDialog
        open={placeOpen}
        internalOrderId={internalOrderId}
        onOpenChange={setPlaceOpen}
      />
      {activeHold ? (
        <ReleaseOrderHoldDialog
          open={releaseOpen}
          hold={activeHold}
          onOpenChange={setReleaseOpen}
          onReleased={handleReleased}
        />
      ) : null}
    </section>
  );
}
