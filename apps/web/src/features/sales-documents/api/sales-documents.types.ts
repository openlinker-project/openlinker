/**
 * Sales Documents — view types (#2159)
 *
 * FE-local view model for the centralized "Settings → Sales documents" table.
 * Deliberately NOT imported from `@openlinker/core/sales-documents` — `apps/web`
 * never imports `@openlinker/core/*` (it talks to the API over HTTP only), so
 * the capability/kind vocabulary is mirrored here, matching the existing
 * `INVOICE_TRIGGER_MODEL_VALUES` mirror precedent in
 * `features/connections/types/invoice-trigger-model.types.ts`.
 *
 * @module apps/web/src/features/sales-documents/api
 */
import type { ConnectionStatus } from '../../connections';

/**
 * The two capabilities that make a connection a sales-document routing
 * candidate (ADR-041 decision 4), plus `'Both'` (#3195) for a connection that
 * has enabled BOTH — a dual-role connection, which may then be configured to
 * issue either document kind per order (`documentKind: 'both'`).
 * `deriveSalesDocumentRows` resolves `'Both'` when a connection declares both
 * capabilities, `'Invoicing'` / `'Fiscalization'` otherwise.
 */
export type SalesDocumentCapability = 'Invoicing' | 'Fiscalization' | 'Both';

/**
 * Well-known document kinds core recognizes structurally, mirroring
 * `CoreSalesDocumentKindValues` (`@openlinker/core/sales-documents`), plus the
 * `'both'` dual-role config sentinel (#3195, mirroring
 * `SALES_DOCUMENT_KIND_BOTH`). Kept in lockstep by convention, not by import —
 * see the module doc comment above.
 */
export const SALES_DOCUMENT_KIND_VALUES = ['invoice', 'fiscal-receipt', 'both'] as const;
export type SalesDocumentKind = (typeof SALES_DOCUMENT_KIND_VALUES)[number];

/** One row of the centralized table: one connection, its routing config. */
export interface SalesDocumentRow {
  connectionId: string;
  name: string;
  platformType: string;
  status: ConnectionStatus;
  capability: SalesDocumentCapability;
  /** `null` = "Nothing" (config.salesDocument.documentKind unset). */
  documentKind: SalesDocumentKind | null;
  /** config.invoicing.isPrimary — the SAME flag for both capabilities (ADR-041 decision 4). */
  isPrimary: boolean;
  /** config.invoicing.triggerModel, defaulted to 'manual' like the BE reader. */
  triggerModel: string;
}

export interface SalesDocumentIssuesOption {
  value: SalesDocumentKind | '';
  label: string;
}

/**
 * Capability-constrained "Issues" options — never an option the connection's
 * enabled capabilities cannot back (mockup tab 02 "Configuration"). `'Both'`
 * (#3195) additionally offers `'both'`, so a dual-role connection can be
 * configured to issue either kind per order rather than being pinned to one.
 */
export function getSalesDocumentIssuesOptions(
  capability: SalesDocumentCapability,
): SalesDocumentIssuesOption[] {
  if (capability === 'Invoicing') {
    return [
      { value: 'invoice', label: 'Invoice' },
      { value: '', label: 'Nothing' },
    ];
  }
  if (capability === 'Fiscalization') {
    return [
      { value: 'fiscal-receipt', label: 'Fiscal receipt' },
      { value: '', label: 'Nothing' },
    ];
  }
  return [
    { value: 'fiscal-receipt', label: 'Receipts' },
    { value: 'invoice', label: 'Invoices' },
    { value: 'both', label: 'Both' },
    { value: '', label: 'Nothing' },
  ];
}

/** Patch applied to one connection's sales-document routing config. */
export interface SalesDocumentConfigPatch {
  documentKind?: SalesDocumentKind | '';
  isPrimary?: boolean;
  triggerModel?: string;
}
