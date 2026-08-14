/**
 * Order Row View-Model Helpers
 *
 * Pure, framework-free derivations for the redesigned orders-list row (#1713):
 * the payment-status badge and the invoice badge (label + tone each). Kept out
 * of the page so the rules are unit-testable in isolation and shared between the
 * desktop table and the mobile card.
 *
 * The multi-item summary (`itemsSummary`, first NAMED item + "+N") lived here
 * until #2091. `OrderIdentityCell` (#2087) now owns that derivation for all
 * three lists that render an order identity, and it counts every line rather
 * than only the named ones — keeping a second, differently-scoped implementation
 * around is what made the same `+N` chip mean two things (#1996).
 *
 * @module apps/web/src/features/orders/lib
 */
import type { ParsedOrderInvoice, PaymentStatus } from '../api/order-snapshot.schema';
import type { StatusBadgeTone } from '../../../shared/ui/status-badge';

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
 * Neutral document types (mirrors `DocumentTypeValues` in
 * `@openlinker/core/invoicing`) that represent a correction rather than an
 * original invoice — the badge prefixes these with `Correction · `.
 */
const CORRECTION_DOCUMENT_TYPES: ReadonlySet<string> = new Set(['corrected', 'credit-note']);

/**
 * Collapse an order's invoice projection (#1713) into one operator-facing badge:
 * the issue lifecycle (`status`) crossed with the neutral CTC clearance
 * lifecycle (`regulatoryStatus`). Correction documents (`documentType` of
 * `corrected` / `credit-note`, #1713) are prefixed `Correction · …` so a KOR
 * reads distinctly from an original invoice. Only called when an invoice record
 * exists — a missing invoice is rendered as the "Issue invoice" action by the
 * caller, not here. Colour is never the only signal; the label always ships
 * alongside.
 */
export function invoiceBadge(invoice: ParsedOrderInvoice): {
  label: string;
  tone: StatusBadgeTone;
} {
  const base = invoiceBadgeBase(invoice);
  const isCorrection = invoice.documentType
    ? CORRECTION_DOCUMENT_TYPES.has(invoice.documentType)
    : false;
  return isCorrection ? { ...base, label: `Correction · ${base.label}` } : base;
}

function invoiceBadgeBase(invoice: ParsedOrderInvoice): {
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
