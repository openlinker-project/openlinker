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
  if (!reason || invoiceSupersedesBlock(invoice)) return null;

  // `unresolved-routing` is the only reason whose copy depends on a second field
  // (ADR-041 §107's paired routing reason), so it is resolved before the table.
  if (reason === 'unresolved-routing' && unresolvedReason === 'ambiguous-connection-no-primary') {
    return {
      label: 'No primary',
      tone: 'error',
      hint: 'Several connections can invoice and none is set to issue automatically.',
      keepIssueAction: false,
    };
  }

  return BADGE_BY_REASON[reason] ?? null;
}

/**
 * Copy + tone per gate reason.
 *
 * `satisfies Record<SalesDocumentGateBlockReasonValue, …>` is the point: a reason
 * added to ADR-041's union is a COMPILE error here rather than a silently
 * unlabelled row. The mirror script only keeps the two arrays aligned — it cannot
 * see this table, and a reason added to both arrays with no entry here would
 * otherwise render nothing at all, which is the exact failure #2100 exists to fix.
 */
const BADGE_BY_REASON = {
  // The generic arm of `unresolved-routing`: any other routing reason belongs to
  // the #1908 router, which does not exist yet. Honest generic rather than copy
  // invented for a state no code path can currently produce.
  'unresolved-routing': {
    label: 'Not routed',
    tone: 'error',
    hint: 'OpenLinker could not decide where to issue this document.',
    keepIssueAction: false,
  },
  // Neutral on purpose: a deliberate operator setting is not a fault. The fact is
  // still recorded so the row is honest about why nothing happened, and the CTA
  // stays because issuing by hand IS this connection's configured workflow.
  'trigger-model-manual': {
    label: 'Manual only',
    tone: 'neutral',
    hint: 'This connection issues invoices by hand.',
    keepIssueAction: true,
  },
  'trigger-model-batched': {
    label: 'Batched',
    tone: 'warning',
    hint: "Batched invoicing isn't available yet, so this order is waiting.",
    keepIssueAction: false,
  },
  // Declared by ADR-041 but never written today (no buyer tax id exists on the
  // order contract). Copy ships so the badge is right the day it does.
  'missing-required-tax-id': {
    label: 'Tax ID missing',
    tone: 'error',
    hint: 'This order needs a buyer tax ID before it can be invoiced.',
    keepIssueAction: false,
  },
  // #2248 (ADR-063). The one reason where `keepIssueAction: false` means the
  // action is genuinely unavailable rather than merely unhelpful: issuing by
  // hand would make a provider guess a rate onto a real fiscal document, so the
  // backend refuses the manual paths too. Every other `false` above is a
  // presentation choice; this one matches a server-side refusal.
  'missing-tax-rate': {
    label: 'No tax rate',
    tone: 'error',
    // Subject-neutral on purpose (#2260 review): the gate blocks on a rate-less
    // product line AND on a delivery charge that cannot be attributed to any
    // rate, and a row carries no line data to tell the two apart. Naming a
    // product here was false for the second shape; the panel, which does hold
    // the lines, names the subject.
    hint: 'Something on this order has no tax rate, so no document can state the tax charged.',
    keepIssueAction: false,
  },
  // Declared but never written today, and it stays that way: a shop-versus-channel
  // disagreement does not block (#2245 F1). It surfaces on its own field with its
  // own resolver, because a badge routed through here would never render - the
  // resolver below suppresses one whenever an invoice exists, and a non-blocking
  // conflict always has one.
  'tax-rate-conflict': {
    label: 'Tax rate conflict',
    tone: 'error',
    hint: "The channel's tax rate disagrees with the master catalogue.",
    keepIssueAction: false,
  },
} satisfies Record<SalesDocumentGateBlockReasonValue, InvoicingBlockedBadge>;

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
