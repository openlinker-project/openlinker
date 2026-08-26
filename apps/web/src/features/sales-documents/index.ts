/**
 * Sales Documents — public surface (#2159)
 *
 * Public barrel for the sales-documents feature. Anything other features,
 * pages, or plugins consume must be re-exported here; deep imports into
 * `features/sales-documents/api|hooks|lib|components` are banned by ESLint
 * for cross-feature consumers (#609).
 */
export { SalesDocumentsPanel } from './components/sales-documents-panel';
export { SalesDocumentsTile } from './components/sales-documents-tile';
export { SalesDocumentRuleEnginePanel } from './components/sales-document-rule-engine-panel';

export type {
  SalesDocumentCapability,
  SalesDocumentKind,
  SalesDocumentRow,
  SalesDocumentConfigPatch,
} from './api/sales-documents.types';
export { SALES_DOCUMENT_KIND_VALUES, getSalesDocumentIssuesOptions } from './api/sales-documents.types';

export { deriveSalesDocumentRows } from './lib/derive-sales-document-rows';
export { detectSalesDocumentConflict } from './lib/detect-sales-document-conflict';
export type { SalesDocumentConflictKind } from './lib/detect-sales-document-conflict';

// #2534 - the one reason-to-copy map every sales-document surface reads. Its
// keys are guarded against the backend unions by
// `scripts/check-sales-document-reason-mirror.mjs`.
export {
  SALES_DOCUMENT_GATE_REASON_COPY,
  SALES_DOCUMENT_UNRESOLVED_REASON_COPY,
  resolveSalesDocumentReasonCopy,
} from './lib/sales-document-reason-copy';
export type {
  SalesDocumentReasonCopy,
  SalesDocumentGateReasonCopy,
  SalesDocumentReasonTone,
  ResolvedSalesDocumentReasonCopy,
} from './lib/sales-document-reason-copy';
