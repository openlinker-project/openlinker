/**
 * Sales-document block copy (#2160)
 *
 * Resolves the operator-facing copy for the unified `SalesDocumentPanel`'s
 * empty state — the "routing/gate-block reason" the mockup's tab 04 keeps
 * visually and textually distinct from a write-path refusal (see
 * `sales-document-panel.tsx` for that distinction).
 *
 * SCOPE NOTE: the persisted-block-reason surface the mockup and #2160's issue
 * body describe — `SalesDocumentGateBlockReason` / `SalesDocumentUnresolvedReason`
 * (`libs/core/src/sales-documents/domain/types/sales-document-reason.types.ts`,
 * ADR-041 decision 11) persisted onto the order and read back by the FE — is
 * NOT yet wired end-to-end on this branch: no repository column carries it, no
 * API response field exposes it, and no FE type mirrors it (verified: neither
 * `InvoiceRecord` nor `FiscalRegistrationRecord` has a block-reason field, and
 * nothing in `apps/web/src` consumes the core union). The referenced
 * `apps/web/src/features/invoicing/lib/sales-document-block-copy.ts` from
 * #2100/#2129 does not exist on this branch either.
 *
 * This helper is therefore scoped to the ONE reason the codebase can compute
 * TODAY, client-side, from data already in hand: several active `Invoicing`
 * connections with none marked primary (`config.invoicing.isPrimary`) — the
 * same client-derived gate `OrderInvoicePanel` rendered pre-#2160 as
 * `requiresConnectionPick`. It is written in the shape ADR-041 §11
 * anticipates (a `{ reason, title, body }` triple keyed off a neutral reason
 * value) so that wiring the real persisted-reason read later is an ADDITIVE
 * change to this function's body, not a call-site rewrite.
 *
 * Fiscalization has no equivalent gate today — v1 registers only on an
 * explicit operator request with no auto-issue/primary concept (ADR-042
 * decision 9), so there is no "ambiguous, none primary" state to report for
 * receipts. `kind: 'receipt'` therefore always resolves to `null`.
 *
 * @module apps/web/src/features/orders/lib
 */

export type SalesDocumentBlockReason = 'ambiguous-connection-no-primary';

export interface SalesDocumentBlockCopy {
  reason: SalesDocumentBlockReason;
  title: string;
  body: string;
}

type Translate = (key: string, fallback: string) => string;

export function resolveSalesDocumentBlockCopy(
  kind: 'invoice' | 'receipt',
  hasAmbiguousNoPrimary: boolean,
  t: Translate,
): SalesDocumentBlockCopy | null {
  if (kind !== 'invoice' || !hasAmbiguousNoPrimary) {
    return null;
  }
  return {
    reason: 'ambiguous-connection-no-primary',
    title: t(
      'salesDocument.block.noPrimaryTitle',
      'Automatic invoicing is off for this order.',
    ),
    body: t(
      'salesDocument.block.noPrimaryBody',
      'Several connections can issue invoices and none is marked primary, so OpenLinker issued nothing rather than issuing twice. Pick a connection above to issue this one by hand, or set a primary so it happens on its own.',
    ),
  };
}
