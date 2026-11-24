/**
 * Order Refund-State Badge (#4130)
 *
 * Shows that an order has been refunded in part or in full, from the refund
 * state the API derives from the order's refund records. A separate badge beside
 * the payment-status one, never a replacement for it: the payment status is the
 * channel's claim and the next poll rewrites it, so it keeps saying `paid` after
 * a partial refund. `unknown` (currency mismatch, tax-exclusive total) and absent
 * render nothing - the badge never states a refund fact it cannot support.
 *
 * One renderer for the list row (compact), the mobile card and the detail header.
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactNode } from 'react';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { interpolate, useFormat, useMessages } from '../../../shared/i18n';
import type { OrderRefundState } from '../api/orders.types';

export interface OrderRefundStateBadgeProps {
  refundState: OrderRefundState | undefined;
  compact?: boolean;
  emptyFallback?: ReactNode;
}

export function OrderRefundStateBadge({
  refundState,
  compact = false,
  emptyFallback = null,
}: OrderRefundStateBadgeProps): ReactNode {
  const copy = useMessages('orders').refundStateBadge;
  const format = useFormat();
  if (!refundState || (refundState.state !== 'partial' && refundState.state !== 'full')) {
    return emptyFallback;
  }

  const label = refundState.state === 'partial' ? copy.partial : copy.full;
  const amount = Number(refundState.refundedAmount);
  const title =
    refundState.currency !== null && Number.isFinite(amount)
      ? interpolate(copy.title, { label, amount: format.money(amount, refundState.currency) })
      : label;

  return (
    <span title={title}>
      <StatusBadge
        tone={refundState.state === 'partial' ? 'warning' : 'neutral'}
        withDot
        compact={compact}
      >
        {label}
      </StatusBadge>
    </span>
  );
}
