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
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';

import {
  interpolate,
  renderRich,
  useMessages,
  type Messages,
  type ResolvedCopy,
} from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { TimeDisplay } from '../../../shared/ui/time-display';
import { useIsAdmin, useWriteAccess } from '../../../shared/auth/use-permission';
import { demoReadOnlyActionMessage } from '../../../shared/config/demo-mode';
import { useDemoMode } from '../../system';
import type { OrderHold, ProvisioningResume } from '../api/orders.types';
import { holdReasonLabel, isReleasedByOrderCancel } from '../lib/order-hold.types';
import { PlaceOrderHoldDialog } from './place-order-hold-dialog';
import { ReleaseOrderHoldDialog } from './release-order-hold-dialog';

export interface OrderHoldPanelProps {
  internalOrderId: string;
  /** The open hold, or null/undefined when the order is not held. */
  activeHold: OrderHold | null | undefined;
  /** Every hold this order has carried. Absent on a pre-#2341 payload. */
  holdHistory: OrderHold[] | null | undefined;
}

type PanelCopy = ResolvedCopy<Messages['orders']>['holds']['panel'];

const actorPart = (text: string): ReactNode => <span className="mono-text">{text}</span>;

/** "since 2 hours ago", or "since 2 hours ago by svc" when the placer is recorded. */
function renderActiveSince(hold: OrderHold, copy: PanelCopy): ReactNode {
  const actor = hold.placedByService ?? hold.placedByUserId;
  const time = (): ReactNode => <TimeDisplay iso={hold.placedAt} format="relative" />;
  return actor
    ? renderRich(copy.activeSinceBy, { time, actor: actorPart }, { actor })
    : renderRich(copy.activeSince, { time });
}

/** "held 2 days ago", with the placer when recorded. */
function renderHeld(hold: OrderHold, copy: PanelCopy): ReactNode {
  const actor = hold.placedByService ?? hold.placedByUserId;
  const time = (): ReactNode => <TimeDisplay iso={hold.placedAt} format="relative" />;
  return actor
    ? renderRich(copy.historyHeldBy, { time, actor: actorPart }, { actor })
    : renderRich(copy.historyHeld, { time });
}

/** "released 1 day ago", with who released it when that is known. */
function renderReleased(hold: OrderHold, copy: PanelCopy): ReactNode {
  const time = (): ReactNode =>
    hold.releasedAt ? <TimeDisplay iso={hold.releasedAt} format="relative" /> : null;
  if (hold.releasedByUserId) {
    return renderRich(
      copy.historyReleasedBy,
      { time, actor: actorPart },
      { actor: hold.releasedByUserId },
    );
  }
  if (isReleasedByOrderCancel(hold)) return renderRich(copy.historyReleasedByCancel, { time });
  return renderRich(copy.historyReleased, { time });
}

export function OrderHoldPanel({
  internalOrderId,
  activeHold,
  holdHistory,
}: OrderHoldPanelProps): ReactElement {
  const holds = useMessages('orders').holds;
  const copy = holds.panel;
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

  // Belt AND braces against the leak: the detail page keys this panel per order
  // so it remounts, and this clears the flag even if a future caller drops that
  // key. `resumeFailure` was previously cleared ONLY by a release, so navigating
  // to a CACHED next order (the page early-returns a skeleton on `isLoading`
  // only, so no remount happens) showed "this order did not start moving again"
  // over an order that was never held.
  useEffect(() => {
    setResumeFailure(false);
  }, [internalOrderId]);

  const released = (holdHistory ?? []).filter((hold) => hold.releasedAt !== null);

  const handleReleased = (resume: ProvisioningResume | undefined): void => {
    setResumeFailure(resume?.status === 'failed');
  };

  return (
    <section className="detail-section">
      <h3 className="detail-section__title">{copy.title}</h3>

      {resumeFailure ? (
        <Alert tone="warning">
          {renderRich(copy.resumeFailed, { strong: (text) => <strong>{text}</strong> })}
        </Alert>
      ) : null}

      <div className="ds-row order-hold-panel">
        {activeHold ? (
          <span className="order-hold-panel__state">
            <StatusBadge tone="warning" withDot compact>
              {interpolate(holds.onHold, { reason: holdReasonLabel(activeHold.reason) })}
            </StatusBadge>{' '}
            {renderActiveSince(activeHold, copy)}
            {activeHold.note ? (
              <span className="order-hold-panel__note"> - {activeHold.note}</span>
            ) : null}
          </span>
        ) : (
          <span className="text-muted">{copy.notOnHold}</span>
        )}

        {canAct ? (
          <ReadOnlyLock active={write.demoReadOnly} message={demoReadOnlyActionMessage()}>
            <Button
              tone={activeHold ? 'primary' : 'secondary'}
              className="button--sm"
              disabled={write.demoReadOnly}
              onClick={() => (activeHold ? setReleaseOpen(true) : setPlaceOpen(true))}
            >
              {activeHold ? copy.release : copy.place}
            </Button>
          </ReadOnlyLock>
        ) : null}
      </div>

      {released.length > 0 ? (
        <ol className="order-hold-panel__history">
          {released.map((hold) => (
            <li key={hold.id} className="order-hold-panel__history-item">
              <span className="text-muted">
                {holdReasonLabel(hold.reason)} · {renderHeld(hold, copy)}, {renderReleased(hold, copy)}
                {hold.releaseNote ? ` - ${hold.releaseNote}` : ''}
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
