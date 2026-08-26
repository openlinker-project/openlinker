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
import type {
  SalesDocumentGateBlockReasonValue,
  SalesDocumentUnresolvedReasonValue,
} from '../api/orders.types';
// #2534 - the single reason-to-copy map. This row states the persisted reason
// and never re-derives one, so the label it shows and the sentence the panel
// shows cannot describe the same order differently.
import { resolveSalesDocumentReasonCopy } from '../../sales-documents';

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
   * Whether the row should still offer to issue the document alongside the
   * badge. Carried by the shared copy entry (#2534) rather than decided here,
   * so a row and a panel cannot disagree about whether an action exists.
   */
  keepIssueAction: boolean;
}

/**
 * Does this order's invoice projection supersede a persisted sales-document
 * block (#2100)?
 *
 * The FE half of `InvoiceRecord.blocksIssuanceElsewhere`, which the backend gate
 * applies before persisting a block at all — the projection ships the derived
 * boolean rather than `failureMode` precisely so this cannot re-derive it and
 * drift. The two MUST agree: the aggregate count and the `?invoicing=blocked`
 * filter have no invoice awareness, so a block the backend keeps but every FE
 * surface hides becomes a number with no reachable explanation — the silent
 * decline ADR-041 §54 forbids, in a new place.
 *
 * A `failed` invoice is deliberately NOT enough on its own. Only a terminal
 * REJECTED failure (the provider is known to have created nothing) leaves the
 * block standing; an `in-doubt` failure may well have produced a document, and
 * "no fiscal document was issued" is the dangerous claim to make there.
 *
 * Absent field (a snapshot older than #2100) ⇒ treated as superseding, matching
 * the pre-#2100 "any invoice hides the badge" behaviour.
 */
export function invoiceSupersedesBlock(invoice?: ParsedOrderInvoice | null): boolean {
  if (!invoice) return false;
  return invoice.blocksIssuanceElsewhere !== false;
}

/**
 * Collapse a persisted sales-document block into the row badge (#2100).
 *
 * Reads the shared reason-to-copy map (#2534) so the row, the popover and the
 * panel state one persisted reason in one vocabulary. It keys on the ROUTING
 * reason when one travelled alongside the gate's `'unresolved-routing'` bridge
 * value (ADR-041 §107): "routing was unresolved" is not something an operator
 * can act on, "two rules matched" is.
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
  /**
   * The order's invoice projection, when it has one. It suppresses the badge
   * exactly when it reports a document that plausibly exists — see
   * `invoiceSupersedesBlock`. A "No primary" pill beside an issued invoice is
   * worse than no pill at all; a pill beside a REJECTED one is the only remaining
   * statement of why auto-issue never ran.
   *
   * A parameter rather than a caller-side `if`, because every surface driven by
   * THIS function must apply the same rule. It previously lived in a page-local
   * helper and the order-detail timeline simply didn't have it, so the timeline
   * claimed "No invoice issued" directly under the panel showing the invoice
   * (#2100 review). The invoice panel is the deliberate exception: it renders from
   * `resolveSalesDocumentBlockCopy` (a different, longer copy set) and applies the
   * same rule at its own call site, because it already holds the live invoice query
   * rather than a snapshot projection.
   */
  invoice?: ParsedOrderInvoice | null,
): InvoicingBlockedBadge | null {
  if (invoiceSupersedesBlock(invoice)) return null;

  const copy = resolveSalesDocumentReasonCopy(reason, unresolvedReason);
  if (!copy) return null;

  return {
    label: copy.short,
    tone: copy.tone,
    hint: copy.detail,
    keepIssueAction: copy.keepsAction,
  };
}

/**
 * The rate-conflict badge (#2254, epic F1).
 *
 * Its OWN resolver, deliberately separate from `invoicingBlockedBadge`. That
 * one returns `null` whenever `invoiceSupersedesBlock` holds - which it does for
 * any invoice that plausibly exists - and a conflict does not stop the invoice,
 * so the invoice always exists and the badge would never render. Routing this
 * through the gate machinery would also double-count it inside
 * `salesDocumentBlocked`, against its own chip.
 *
 * It takes no invoice argument at all, which is the point: an issued invoice is
 * the ordinary case here, not a reason to suppress.
 */
export function taxRateConflictBadge(): { label: string; hint: string } {
  return {
    label: 'Rate conflict',
    hint: "The invoice used the shop's rate; the channel reported a different one.",
  };
}
