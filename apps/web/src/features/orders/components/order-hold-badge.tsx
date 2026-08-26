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
 * Renders nothing for an absent or unrecognised reason — the `OrderPhaseBadge`
 * contract. A payload predating #2340 carries no reason at all, and a reason
 * this build does not know is not one it can label honestly.
 *
 * The source is `OrderRecord.activeHoldReason`, which is #2340's display cache
 * with an hourly repair window. That is exactly what a badge may read and what
 * no gate may: both write routes decide against `order_holds` server-side.
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactElement } from 'react';

import { StatusBadge } from '../../../shared/ui/status-badge';
import { HOLD_REASON_COPY, isHoldReason } from '../lib/order-hold.types';

interface OrderHoldBadgeProps {
  /** The row/detail `activeHoldReason`; unknown or absent renders nothing. */
  reason: string | null | undefined;
  /** Compact badge for a table row / card badge-row; the detail header is not. */
  compact?: boolean;
}

export function OrderHoldBadge({ reason, compact = false }: OrderHoldBadgeProps): ReactElement | null {
  if (!isHoldReason(reason)) return null;
  const copy = HOLD_REASON_COPY[reason];

  return (
    // `StatusBadge` takes no `title`, so the hint rides on a wrapper — and it is
    // written out for a screen reader too, because WHY an order is held is the
    // load-bearing half of this badge rather than a hover nicety.
    <span className="order-hold-badge" title={copy.hint}>
      <StatusBadge tone="warning" withDot compact={compact}>
        {`On hold — ${copy.label}`}
      </StatusBadge>
      <span className="sr-only">{` — ${copy.hint}`}</span>
    </span>
  );
}
