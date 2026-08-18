/**
 * Sales-Document Block Copy (#2100)
 *
 * Turns the backend's recorded auto-issue block into operator-facing copy for the
 * order-detail invoice panel. Pure and `t()`-injected — no React, no hooks, no
 * I/O — so all seven branches are unit-testable directly instead of only through a
 * full component render, matching the five sibling helpers in this folder.
 *
 * @module apps/web/src/features/invoicing/lib
 */
import type { OrderRecord } from '../../orders';


/** One rendered explanation of why this order carries no fiscal document (#2100). */
export interface SalesDocumentBlockCopy {
  tone: 'warning' | 'error' | 'info';
  title: string;
  body: string;
  /** PII-free elaboration the backend supplied, if any. */
  detail: string | null;
  /** Whether to offer the one-click "Set a primary" remediation. */
  offerSetPrimary: boolean;
}

/**
 * Turn the backend's recorded block into operator-facing copy (#2100, ADR-041
 * decision 11).
 *
 * Reads `order.salesDocumentBlockReason` — the gate's own decision — rather than
 * re-deriving anything. Keys on the paired ROUTING reason for a
 * `'unresolved-routing'` block (ADR-041 §107), because "routing was unresolved"
 * is not actionable while "no primary invoicing connection" is.
 *
 * `derivedAmbiguity` is a FALLBACK ONLY, for an order the gate has not
 * re-evaluated since this shipped (the columns are nullable with no backfill —
 * inventing a historical reason would badge orders wrongly). The persisted value
 * always wins when present, so backend and frontend can no longer disagree about
 * a block the backend actually recorded.
 *
 * Copy rule, carried over from `InvoiceConnectionLock`: state the fact, then the
 * one action that changes it. No apology, and the reason literal never reaches the
 * screen.
 */
export function resolveSalesDocumentBlockCopy(
  order: OrderRecord,
  derivedAmbiguity: boolean,
  t: (key: string, fallback: string) => string,
): SalesDocumentBlockCopy | null {
  const reason = order.salesDocumentBlockReason ?? null;
  const detail = order.salesDocumentBlockDetail ?? null;

  if (reason === null) {
    if (!derivedAmbiguity) return null;
    return {
      tone: 'warning',
      title: t('invoice.panel.noPrimaryTitle', 'Automatic invoicing is off for this order.'),
      body: t(
        'invoice.panel.noPrimaryBody',
        'Several connections can issue invoices and none is marked primary, so OpenLinker issued nothing rather than issuing twice. Pick a connection above to issue this one by hand, or set a primary so it happens on its own.',
      ),
      detail: null,
      offerSetPrimary: true,
    };
  }

  if (reason === 'unresolved-routing') {
    if (order.salesDocumentUnresolvedReason === 'ambiguous-connection-no-primary') {
      return {
        tone: 'error',
        title: t('invoice.panel.blockNoPrimaryTitle', 'Not invoiced: no primary connection.'),
        body: t(
          'invoice.panel.blockNoPrimaryBody',
          'Several connections can issue invoices and none is set to issue automatically, so OpenLinker issued nothing rather than issuing twice. Set a primary, or pick a connection above and issue this one by hand.',
        ),
        detail,
        offerSetPrimary: true,
      };
    }
    return {
      tone: 'error',
      title: t('invoice.panel.blockUnroutedTitle', 'Not invoiced: no route for this document.'),
      body: t(
        'invoice.panel.blockUnroutedBody',
        'OpenLinker could not decide where to issue this document. Pick a connection above to issue it by hand.',
      ),
      detail,
      offerSetPrimary: false,
    };
  }

  if (reason === 'trigger-model-manual') {
    return {
      // Quiet on purpose: a manual connection is a deliberate operator choice, not
      // a misconfiguration. The fact is still stated so the panel never looks like
      // it simply forgot.
      tone: 'info',
      title: t('invoice.panel.blockManualTitle', 'This connection invoices by hand.'),
      body: t(
        'invoice.panel.blockManualBody',
        'Nothing is wrong — no invoice is issued automatically here. Issue this one whenever you are ready.',
      ),
      detail,
      offerSetPrimary: false,
    };
  }

  if (reason === 'trigger-model-batched') {
    return {
      tone: 'warning',
      title: t(
        'invoice.panel.blockBatchedTitle',
        'Not invoiced: batched invoicing is not available yet.',
      ),
      body: t(
        'invoice.panel.blockBatchedBody',
        'OpenLinker cannot group this order into a batch, so it issued nothing. Issue it by hand, or switch the connection to issue on payment.',
      ),
      detail,
      offerSetPrimary: false,
    };
  }

  if (reason === 'missing-required-tax-id') {
    return {
      tone: 'error',
      title: t('invoice.panel.blockTaxIdTitle', 'Not invoiced: the buyer tax ID is missing.'),
      body: t(
        'invoice.panel.blockTaxIdBody',
        'This document cannot be issued without the buyer tax ID the destination requires.',
      ),
      detail,
      offerSetPrimary: false,
    };
  }

  if (reason === 'tax-rate-conflict') {
    return {
      tone: 'error',
      title: t('invoice.panel.blockTaxRateTitle', 'Not invoiced: the tax rates disagree.'),
      body: t(
        'invoice.panel.blockTaxRateBody',
        "The channel's tax rate does not match the master catalogue, so OpenLinker did not issue a document it could not vouch for.",
      ),
      detail,
      offerSetPrimary: false,
    };
  }

  // A reason this build does not recognise (a newer backend). Say the honest
  // minimum rather than nothing — the operator still needs to know why the order
  // has no document.
  return {
    tone: 'warning',
    title: t('invoice.panel.blockUnknownTitle', 'Not invoiced.'),
    body: t(
      'invoice.panel.blockUnknownBody',
      'OpenLinker declined to issue a document for this order. Issue it by hand if it should be invoiced.',
    ),
    detail,
    offerSetPrimary: false,
  };
}
