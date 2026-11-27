/**
 * Order Hidden Badge (#4289)
 *
 * The Status-group badge for an order the buyer data retention rule hid. It sits
 * BESIDE order health, never inside it (`OrderHealthValues` is a partition that
 * sums to the KPI cards). It only ever renders on the "Hidden" view of the
 * list, because hidden orders are excluded from every other one. When the
 * buyer's personal data was also erased the tooltip says so, so the masked buyer
 * in the row reads as deliberate rather than as missing data. The label stays
 * short: the Status cell clips a longer one.
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactNode } from 'react';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { useMessages } from '../../../shared/i18n';

export interface OrderHiddenBadgeProps {
  hiddenAt: string | null | undefined;
  personalDataErasedAt: string | null | undefined;
}

export function OrderHiddenBadge({ hiddenAt, personalDataErasedAt }: OrderHiddenBadgeProps): ReactNode {
  const copy = useMessages('orders').hiddenBadge;
  if (!hiddenAt) return null;
  const erased = Boolean(personalDataErasedAt);
  return (
    <span title={erased ? copy.titleErased : copy.title} data-testid="order-hidden-badge">
      <StatusBadge tone="neutral" withDot compact>
        {copy.label}
      </StatusBadge>
    </span>
  );
}
