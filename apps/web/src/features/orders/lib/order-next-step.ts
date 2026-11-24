/**
 * Order next step (#4286)
 *
 * The one thing an operator should look at first on the order detail page,
 * derived from facts the page already holds. It names a tab to open and never
 * invents an action: every step points at a surface that already exists. When
 * nothing is wrong it returns `null` - the page shows no card rather than a
 * reassurance, because an unread source would make "all clear" a false claim.
 *
 * @module apps/web/src/features/orders/lib
 */
import type { OrderDetailTabId } from './order-detail-tabs';

export type OrderNextStepKind =
  | 'failed-destinations'
  | 'on-hold'
  | 'document-blocked'
  | 'ship-by-overdue'
  | 'ready-to-ship';

export type OrderNextStepTone = 'error' | 'warning' | 'info';

export interface OrderNextStep {
  kind: OrderNextStepKind;
  tone: OrderNextStepTone;
  /** The tab that holds the surface to act in. */
  tab: OrderDetailTabId;
  /** Interpolation value for the copy (a count or a reason label). */
  value?: string | number;
}

export interface OrderNextStepInput {
  cancelled: boolean;
  failedDestinationCount: number;
  activeHoldLabel: string | null;
  /** An attention-worthy persisted sales-document block (not a manual-trigger one). */
  documentBlocked: boolean;
  shipByOverdue: boolean;
  /** Fulfilment state from the shipments read; `unavailable` and `dispatched` etc. never prompt. */
  fulfillment: 'not-shipped' | 'dispatched' | 'delivered' | 'failed' | 'unavailable';
}

/** Highest priority first; the first match wins. */
export function deriveOrderNextStep(input: OrderNextStepInput): OrderNextStep | null {
  if (input.failedDestinationCount > 0) {
    return {
      kind: 'failed-destinations',
      tone: 'error',
      tab: 'technical',
      value: input.failedDestinationCount,
    };
  }
  if (input.activeHoldLabel !== null) {
    return { kind: 'on-hold', tone: 'warning', tab: 'packing', value: input.activeHoldLabel };
  }
  if (input.documentBlocked) {
    return { kind: 'document-blocked', tone: 'warning', tab: 'documents' };
  }
  if (input.cancelled) return null;
  if (input.shipByOverdue && input.fulfillment === 'not-shipped') {
    return { kind: 'ship-by-overdue', tone: 'error', tab: 'shipping' };
  }
  if (input.fulfillment === 'failed') {
    return { kind: 'ready-to-ship', tone: 'warning', tab: 'shipping' };
  }
  if (input.fulfillment === 'not-shipped') {
    return { kind: 'ready-to-ship', tone: 'info', tab: 'shipping' };
  }
  return null;
}
