/**
 * Sales Documents — view types (#2159)
 *
 * FE-local view model for the centralized "Settings -> Sales documents routing" table.
 * Deliberately NOT imported from `@openlinker/core/sales-documents` — `apps/web`
 * never imports `@openlinker/core/*` (it talks to the API over HTTP only), so
 * the capability/kind vocabulary is mirrored here, matching the existing
 * `INVOICE_TRIGGER_MODEL_VALUES` mirror precedent in
 * `features/connections/types/invoice-trigger-model.types.ts`.
 *
 * @module apps/web/src/features/sales-documents/api
 */
import type { ConnectionStatus } from '../../connections';
import { getMessages } from '../../../shared/i18n';

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

/**
 * The kind a single fiscal document is actually issued as — never `'both'`.
 * `'both'` is a CONNECTION-role config sentinel (#3195): a saved rule or a
 * country default always names ONE concrete kind for a routing decision to
 * resolve to, even when the connection it names may serve either.
 */
export type ConcreteDocumentKind = Exclude<SalesDocumentKind, 'both'>;

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
  /**
   * The EFFECTIVE trigger model per concrete kind (#3582), resolved like the
   * BE gate: `salesDocument.triggerModels[kind]` → legacy
   * `invoicing.triggerModel` → `'manual'`. Effective rather than raw so the
   * table shows what will be enforced, including an inherited legacy value.
   */
  triggerModels: Record<ConcreteDocumentKind, string>;
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
  const kind = getMessages('sales-documents').documentKind;
  if (capability === 'Invoicing') {
    return [
      { value: 'invoice', label: kind.invoice },
      { value: '', label: kind.nothing },
    ];
  }
  if (capability === 'Fiscalization') {
    return [
      { value: 'fiscal-receipt', label: kind.fiscalReceipt },
      { value: '', label: kind.nothing },
    ];
  }
  return [
    { value: 'fiscal-receipt', label: kind.receipts },
    { value: 'invoice', label: kind.invoices },
    { value: 'both', label: kind.both },
    { value: '', label: kind.nothing },
  ];
}

/** Patch applied to one connection's sales-document routing config. */
export interface SalesDocumentConfigPatch {
  documentKind?: SalesDocumentKind | '';
  isPrimary?: boolean;
  /** One kind's trigger model, written to `salesDocument.triggerModels[kind]` (#3582). */
  triggerModel?: { kind: ConcreteDocumentKind; value: string };
  /**
   * One kind's batch schedule, written to `salesDocument.batchSchedules[kind]`
   * (#3584); `null` removes it.
   */
  batchSchedule?: { kind: ConcreteDocumentKind; value: BatchScheduleConfig | null };
}

/** The stored shape `readBatchSchedule` reads (#3583). */
export interface BatchScheduleConfig {
  frequency: 'daily' | 'every-n-hours' | 'month-end';
  time?: string;
  everyHours?: number;
  timeZone: string;
  /** ISO instant; no slot before it runs, so a new schedule never fires a past slot. */
  effectiveFrom: string;
}
