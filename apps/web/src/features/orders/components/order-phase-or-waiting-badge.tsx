/**
 * Order Phase Or Waiting Badge (#3482)
 *
 * An order OpenLinker is holding shows "Waiting: <reason>" in the Status group
 * INSTEAD OF its lifecycle phase pill, so "On hold" and "Waiting" never sit side
 * by side saying two things about one order. Every other order renders its phase
 * badge unchanged.
 *
 * The reason is the PERSISTED `fulfillmentBlockReason`, never computed here.
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactElement } from 'react';
import { StatusBadge } from '../../../shared/ui/status-badge';
import type { OrderRecord } from '../api/orders.types';
import { deriveWaiting } from '../lib/handled-in-openlinker';
import { OrderPhaseBadge } from './order-phase-badge';

export interface OrderPhaseOrWaitingBadgeProps {
  order: Pick<OrderRecord, 'fulfillmentBlockReason' | 'lifecyclePhase'>;
  compact?: boolean;
}

export function OrderPhaseOrWaitingBadge({
  order,
  compact = false,
}: OrderPhaseOrWaitingBadgeProps): ReactElement | null {
  const waiting = deriveWaiting(order);
  if (!waiting) {
    return <OrderPhaseBadge phase={order.lifecyclePhase} compact={compact} />;
  }
  return (
    <span title={waiting.hint}>
      <StatusBadge tone={waiting.tone} withDot compact={compact}>
        {waiting.label}
      </StatusBadge>
      <span className="sr-only">{` - ${waiting.hint}`}</span>
    </span>
  );
}
