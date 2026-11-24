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

/**
 * Every problem the page can name, highest priority first. The first one is the
 * Next step; the rest are the "Also" line and the "All issues" list (#4286).
 */
export function deriveOrderIssues(input: OrderNextStepInput): OrderNextStep[] {
  const issues: OrderNextStep[] = [];
  if (input.failedDestinationCount > 0) {
    issues.push({
      kind: 'failed-destinations',
      tone: 'error',
      tab: 'technical',
      value: input.failedDestinationCount,
    });
  }
  if (input.activeHoldLabel !== null) {
    issues.push({ kind: 'on-hold', tone: 'warning', tab: 'packing', value: input.activeHoldLabel });
  }
  if (input.documentBlocked) {
    issues.push({ kind: 'document-blocked', tone: 'warning', tab: 'documents' });
  }
  if (input.cancelled) return issues;
  if (input.shipByOverdue && input.fulfillment === 'not-shipped') {
    issues.push({ kind: 'ship-by-overdue', tone: 'error', tab: 'shipping' });
  }
  if (input.fulfillment === 'failed') {
    issues.push({ kind: 'ready-to-ship', tone: 'warning', tab: 'shipping' });
  } else if (input.fulfillment === 'not-shipped') {
    issues.push({ kind: 'ready-to-ship', tone: 'info', tab: 'shipping' });
  }
  return issues;
}

/** The single most important step, or `null` when nothing needs attention. */
export function deriveOrderNextStep(input: OrderNextStepInput): OrderNextStep | null {
  return deriveOrderIssues(input)[0] ?? null;
}
