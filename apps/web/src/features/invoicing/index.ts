/**
 * Invoicing — public surface (#757)
 *
 * Public barrel for the invoicing feature. Cross-feature / page consumers
 * import only from here. Kept narrow (like `orders/index.ts`): the panel, the
 * query/mutation hooks, the query keys, the transport types, the shared display
 * components (status badges, PDF link), and the runtime value arrays used for
 * filter guards on the list page.
 *
 * `resolveIssueErrorMessage`, `DocumentTypeSelect`, and `DOCUMENT_TYPE_LABEL_FALLBACK`
 * stay internal (only used by the panel itself or tests that deep-import them).
 *
 * Exception: `RegulatoryStatusBadge` and `regCardToneFor` are exported so
 * per-provider `invoiceDetailSection` slot components (KSeF, Subiekt,
 * inFakt) can reuse the neutral badge and `.reg-card` tone mapping without
 * duplicating either.
 *
 * @module apps/web/src/features/invoicing
 */
export { OrderInvoicePanel } from './components/order-invoice-panel';
export { InvoiceTimeline } from './components/invoice-timeline';
export { InvoiceStatusBadge } from './components/invoice-status-badge';
export type { InvoiceDisplayStatus } from './components/invoice-status-badge';
export { RegulatoryStatusBadge } from './components/regulatory-status-badge';
export { regCardToneFor, type RegCardTone } from './lib/derive-invoice-display';
export { InvoicePdfLink } from './components/invoice-pdf-link';
export { useOrderInvoiceQuery } from './hooks/use-order-invoice-query';
export { useInvoiceQuery } from './hooks/use-invoice-query';
export { useIssueInvoiceMutation } from './hooks/use-issue-invoice-mutation';
export { useInvoicesQuery } from './hooks/use-invoices-query';
export { useRetryInvoicesMutation } from './hooks/use-retry-invoices-mutation';
export { useBulkIssueInvoicesMutation } from './hooks/use-bulk-issue-invoices-mutation';
export {
  useIssueCorrectionMutation,
  type IssueCorrectionVariables,
} from './hooks/use-issue-correction-mutation';
export { useResendToKsefMutation } from './hooks/use-resend-to-ksef-mutation';
export {
  useSendInvoiceEmailMutation,
  type SendInvoiceEmailVariables,
} from './hooks/use-send-invoice-email-mutation';
export { useKsefUpoPreview } from './hooks/use-ksef-upo-preview';
export type { UpoPreviewKind } from './hooks/use-ksef-upo-preview';
export { useKsefUpoDownload } from './hooks/use-ksef-upo-download';
export { useKsefFa3 } from './hooks/use-ksef-fa3';
export { useInvoiceRenderedDocumentDownload } from './hooks/use-invoice-rendered-document-download';
export { invoicingQueryKeys } from './api/invoicing.query-keys';

// Invoice numbering (binds the numbering-series HTTP API). The API factory rides
// the KSeF plugin's `apiNamespaces` build slot; the hooks/types/lib are
// feature-owned (per-document-type routing + gap-audit, replacing the pre-v2
// main/correction assignment).
export { createNumberingApi, type NumberingApi } from './api/numbering.api';
export { numberingQueryKeys } from './api/numbering.query-keys';
export {
  ResetPolicyValues,
  DocumentTypeValues,
  NumberingSeqStatusValues,
  NumberingPatternVariableValues,
} from './api/numbering.types';
export type {
  ResetPolicy,
  NumberingSeqStatus,
  NumberingPatternVariable,
  NumberingSeries,
  UnassignedNumberingSeries,
  NumberingRoute,
  ListNumberingSeriesFilter,
  CreateNumberingSeriesInput,
  UpdateNumberingSeriesInput,
  UpsertNumberingRouteInput,
  DeleteNumberingRouteInput,
  NumberingGapNote,
  RecordGapNoteInput,
  SeriesAudit,
  SeriesAuditEntry,
  SeriesAuditSummary,
} from './api/numbering.types';
export { useNumberingSeriesQuery } from './hooks/use-numbering-series-query';
export { useNumberingSeriesListQuery } from './hooks/use-numbering-series-list-query';
export { useUnassignedNumberingSeriesQuery } from './hooks/use-unassigned-numbering-series-query';
export { useCreateNumberingSeriesMutation } from './hooks/use-create-numbering-series-mutation';
export {
  useUpdateNumberingSeriesMutation,
  type UpdateNumberingSeriesVariables,
} from './hooks/use-update-numbering-series-mutation';
export { useNumberingRoutesQuery } from './hooks/use-numbering-routes-query';
export {
  useUpsertNumberingRouteMutation,
  type UpsertNumberingRouteVariables,
} from './hooks/use-upsert-numbering-route-mutation';
export {
  useDeleteNumberingRouteMutation,
  type DeleteNumberingRouteVariables,
} from './hooks/use-delete-numbering-route-mutation';
export { useSeriesAuditQuery } from './hooks/use-series-audit-query';
export {
  useRecordGapNoteMutation,
  type RecordGapNoteVariables,
} from './hooks/use-record-gap-note-mutation';
export {
  renderInvoiceNumber,
  validateNumberingPattern,
  type NumberRenderContext,
} from './lib/numbering-pattern';
export { isMissingNumberingSeriesError } from './lib/issue-error-message';
export {
  buildNumberingPreview,
  type NumberingPreview,
  type PreviewToken,
  type PreviewTokenKind,
  type BuildNumberingPreviewInput,
} from './lib/numbering-preview';
export {
  InvoiceStatusValues,
  RegulatoryStatusValues,
  InvoiceEmailLocaleValues,
} from './api/invoicing.types';
export type {
  InvoiceRecord,
  InvoiceStatus,
  FailureMode,
  FailureCode,
  RegulatoryStatus,
  DocumentType,
  IssueInvoiceInput,
  InvoiceFilters,
  InvoicePagination,
  PaginatedInvoices,
  RetryInvoicesInput,
  RetryInvoicesResult,
  RetryInvoiceResult,
  RetryOutcome,
  BulkIssueInvoicesInput,
  BulkIssueInvoicesResult,
  BulkIssueInvoiceResult,
  BulkIssueOutcome,
  CorrectionLineInput,
  IssueCorrectionInput,
  InvoiceEmailLocale,
  SendInvoiceEmailInput,
  SendInvoiceEmailResult,
} from './api/invoicing.types';
