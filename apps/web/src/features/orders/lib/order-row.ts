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
import type {
  SalesDocumentGateBlockReasonValue,
  SalesDocumentUnresolvedReasonValue,
} from '../api/orders.types';

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

// ── Sales-document block badge (#2100) ──────────────────────────────────────

export interface InvoicingBlockedBadge {
  label: string;
  tone: StatusBadgeTone;
  /** One-line cause for the row's `title` tooltip. */
  hint: string;
  /**
   * Whether the row should still offer "Issue invoice" alongside the badge.
   * True only for `trigger-model-manual`, where issuing by hand IS the
   * configured workflow rather than a workaround.
   */
  keepIssueAction: boolean;
}

/**
 * Collapse a persisted sales-document block into the row badge (#2100).
 *
 * Keys on the ROUTING reason when one travelled alongside the gate's
 * `'unresolved-routing'` bridge value (ADR-041 §107): "routing was unresolved"
 * is not something an operator can act on, "no primary invoicing connection" is.
 *
 * A deliberate sibling of {@link invoiceBadge} rather than a branch inside it —
 * that function takes a `ParsedOrderInvoice`, and a blocked order has no invoice
 * record at all.
 *
 * Returns `null` for an unblocked order and for any value this build does not
 * recognise, so a reason added to the backend later renders as "no badge"
 * instead of an unlabelled pill. (`scripts/check-sales-document-reason-mirror.mjs`
 * is what stops that from happening silently; this is the safety net.)
 */
export function invoicingBlockedBadge(
  reason: SalesDocumentGateBlockReasonValue | null | undefined,
  unresolvedReason?: SalesDocumentUnresolvedReasonValue | null,
): InvoicingBlockedBadge | null {
  if (!reason) return null;

  if (reason === 'unresolved-routing') {
    if (unresolvedReason === 'ambiguous-connection-no-primary') {
      return {
        label: 'No primary',
        tone: 'error',
        hint: 'Several connections can invoice and none is set to issue automatically.',
        keepIssueAction: false,
      };
    }
    // Any other routing reason belongs to the #1908 router, which does not exist
    // yet. Report the honest generic rather than inventing copy for a state no
    // code path can currently produce.
    return {
      label: 'Not routed',
      tone: 'error',
      hint: 'OpenLinker could not decide where to issue this document.',
      keepIssueAction: false,
    };
  }

  switch (reason) {
    case 'trigger-model-manual':
      // Neutral on purpose: a deliberate operator setting is not a fault. The
      // fact is still recorded so the row is honest about why nothing happened.
      return {
        label: 'Manual only',
        tone: 'neutral',
        hint: 'This connection issues invoices by hand.',
        keepIssueAction: true,
      };
    case 'trigger-model-batched':
      return {
        label: 'Batched',
        tone: 'warning',
        hint: "Batched invoicing isn't available yet, so this order is waiting.",
        keepIssueAction: false,
      };
    case 'missing-required-tax-id':
      // Declared by ADR-041 but never written today (no buyer tax id exists on
      // the order contract). Copy ships so the badge is right the day it does.
      return {
        label: 'Tax ID missing',
        tone: 'error',
        hint: 'This order needs a buyer tax ID before it can be invoiced.',
        keepIssueAction: false,
      };
    case 'tax-rate-conflict':
      // Declared but never written today — blocked on #2057.
      return {
        label: 'Tax rate conflict',
        tone: 'error',
        hint: "The channel's tax rate disagrees with the master catalogue.",
        keepIssueAction: false,
      };
    default:
      return null;
  }
}
