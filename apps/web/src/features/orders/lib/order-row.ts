/**
 * Order Row View-Model Helpers
 *
 * Pure, framework-free derivations for the redesigned orders-list row (#1713):
 * the multi-item summary (first name + "+N" count) and the payment-status badge
 * (label + tone). Kept out of the page so the rules are unit-testable in
 * isolation and shared between the desktop table and the mobile card.
 *
 * @module apps/web/src/features/orders/lib
 */
import type {
  ParsedOrderInvoice,
  ParsedOrderItem,
  PaymentStatus,
} from '../api/order-snapshot.schema';
import type { StatusBadgeTone } from '../../../shared/ui/status-badge';

/** First named item + how many further lines the order carries. */
export interface ItemsSummary {
  firstName: string;
  /** Count of items beyond the first (0 for a single-item order). */
  moreCount: number;
}

/**
 * Summarise an order's line items for the collapsed row (#1713): the first
 * named item plus a count of the rest, so a multi-item order never masquerades
 * as a single-item one. `null` when the snapshot carries no named items (parse
 * failure or genuinely empty) — the row then shows nothing rather than a blank.
 * The name is returned verbatim; the row truncates it in CSS while the count
 * chip stays fully visible.
 */
export function itemsSummary(items: readonly ParsedOrderItem[]): ItemsSummary | null {
  const names = items.map((i) => i.name).filter((n): n is string => Boolean(n));
  if (names.length === 0) return null;
  const [first, ...rest] = names;
  return { firstName: first, moreCount: rest.length };
}

/** Label + tone per payment status. Colour never carries meaning alone — the
 *  label always ships alongside (StatusBadge enforces the dot + text). */
export const PAYMENT_BADGE_META: Record<PaymentStatus, { label: string; tone: StatusBadgeTone }> = {
  paid: { label: 'Paid', tone: 'success' },
  cod: { label: 'COD', tone: 'review' },
  awaiting: { label: 'Awaiting', tone: 'warning' },
  refunded: { label: 'Refunded', tone: 'neutral' },
};

/**
 * Resolve the payment badge for an order row, or `null` when the source didn't
 * report a status (the cell then shows an em dash rather than a misleading pill).
 */
export function paymentBadge(
  status: PaymentStatus | undefined,
): { label: string; tone: StatusBadgeTone } | null {
  if (!status) return null;
  return PAYMENT_BADGE_META[status];
}

/**
 * Collapse an order's invoice projection (#1713) into one operator-facing badge:
 * the issue lifecycle (`status`) crossed with the neutral CTC clearance
 * lifecycle (`regulatoryStatus`). Only called when an invoice record exists — a
 * missing invoice is rendered as the "Issue invoice" action by the caller, not
 * here. Colour is never the only signal; the label always ships alongside.
 */
export function invoiceBadge(invoice: ParsedOrderInvoice): {
  label: string;
  tone: StatusBadgeTone;
} {
  if (invoice.status === 'failed') return { label: 'Failed', tone: 'error' };
  if (invoice.status === 'pending' || invoice.status === 'issuing') {
    return { label: 'Issuing', tone: 'warning' };
  }
  // status === 'issued' — refine by clearance lifecycle.
  switch (invoice.regulatoryStatus) {
    case 'accepted':
    case 'cleared':
      return { label: 'Cleared', tone: 'success' };
    case 'submitted':
      return { label: 'Submitted', tone: 'info' };
    case 'rejected':
      return { label: 'Rejected', tone: 'error' };
    case 'not-applicable':
    default:
      return { label: 'Issued', tone: 'success' };
  }
}
