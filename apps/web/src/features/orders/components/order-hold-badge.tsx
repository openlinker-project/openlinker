/**
 * Order Hold Badge (#2342)
 *
 * Renders an order's OPEN hold as a `StatusBadge`, from ONE component used by
 * both the desktop row and the mobile card.
 *
 * **It belongs to the STATUS group.** `frontend-ui-style-guide.md` § Order-row
 * signal placement makes an exception a badge (a workflow position is a tick)
 * and puts exceptions in Status beside the failure reasons — the open-return
 * badge is the precedent, and a hold is the same shape of fact: something is
 * outstanding and someone must act. It never joins Shipment or Money.
 *
 * Renders nothing for an ABSENT reason only. An unrecognised one renders a
 * neutral badge carrying the raw value: the order is genuinely held, and a
 * silent badge made it indistinguishable from an un-held order — the one claim
 * this component must never make. The timeline already took that position for
 * the same data.
 *
 * The source is `OrderRecord.activeHoldReason`, which is #2340's display cache
 * with an hourly repair window. That is exactly what a badge may read and what
 * no gate may: both write routes decide against `order_holds` server-side.
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactElement } from 'react';

import { StatusBadge } from '../../../shared/ui/status-badge';
import { interpolate, useMessages } from '../../../shared/i18n';
import { holdReasonHint, holdReasonLabel } from '../lib/order-hold.types';

interface OrderHoldBadgeProps {
  /** The row/detail `activeHoldReason`; unknown or absent renders nothing. */
  reason: string | null | undefined;
  /** Compact badge for a table row / card badge-row; the detail header is not. */
  compact?: boolean;
}

export function OrderHoldBadge({ reason, compact = false }: OrderHoldBadgeProps): ReactElement | null {
  const copy = useMessages('orders').holds;
  // Absence is the ONLY thing that renders nothing. An unrecognised reason used
  // to render nothing too, which made a held order look unheld — it survived
  // only because `deriveOrderLifecyclePhase` keys `held` off the same field, an
  // accident of a sibling derivation rather than a property of this component.
  // The timeline made the opposite call and said so; this now matches it.
  if (reason === null || reason === undefined || reason === '') return null;

  // An unrecognised reason gets the generic hint: the order IS held - a newer
  // backend simply named a reason this bundle predates - so the badge says the
  // true, useful half and declines to invent the rest.
  const label = holdReasonLabel(reason);
  const hint = holdReasonHint(reason);

  return (
    // `StatusBadge` takes no `title`, so the hint rides on a wrapper — and it is
    // written out for a screen reader too, because WHY an order is held is the
    // load-bearing half of this badge rather than a hover nicety.
    <span className="order-hold-badge" title={hint}>
      <StatusBadge tone="warning" withDot compact={compact}>
        {interpolate(copy.onHold, { reason: label })}
      </StatusBadge>
      <span className="sr-only">{` - ${hint}`}</span>
    </span>
  );
}
