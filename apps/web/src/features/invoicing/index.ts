/**
 * Invoicing — public surface (#757)
 *
 * Public barrel for the invoicing feature. Cross-feature / page consumers
 * import only from here. Kept narrow (like `orders/index.ts`): the
 * query/mutation hooks, the query keys, the transport types, the shared display
 * components (status badges, PDF link), and the runtime value arrays used for
 * filter guards on the list page.
 *
 * Exception: `RegulatoryStatusBadge` and `regCardToneFor` are exported so
 * per-provider `invoiceDetailSection` slot components (KSeF, Subiekt,
 * inFakt) can reuse the neutral badge and `.reg-card` tone mapping without
 * duplicating either.
 *
 * `InvoiceConnectionLock`, `DocumentTypeSelect`, `DOCUMENT_TYPE_LABEL_FALLBACK`,
 * `resolveIssueErrorMessage`, `isMissingNumberingSeriesError`, the
 * connection-resolution helpers, and the display-derivation helpers were
 * exported for `OrderInvoicePanel`'s own use only until #2160, which replaced
 * that component with the `orders` feature's `SalesDocumentPanel` — a
 * cross-feature consumer that reassembles the same lifecycle rendering inside
 * the unified "Sales document" slot (ADR-041). They are now genuinely
 * cross-feature and stay exported here rather than duplicated.
 *
 * @module apps/web/src/features/invoicing
 */
export { InvoiceTimeline } from './components/invoice-timeline';
export { InvoiceStatusBadge } from './components/invoice-status-badge';
export type { InvoiceDisplayStatus } from './components/invoice-status-badge';
export {
  RegulatoryStatusBadge,
  REGULATORY_STATUS_LABEL_FALLBACK,
} from './components/regulatory-status-badge';
export { regCardToneFor, type RegCardTone } from './lib/derive-invoice-display';
export { InvoicePdfLink } from './components/invoice-pdf-link';
export { InvoiceMarketplaceUploadStatus } from './components/invoice-marketplace-upload-status';
export { InvoiceConnectionLock } from './components/invoice-connection-lock';
export { InvoiceUnconfirmedNotice } from './components/invoice-unconfirmed-notice';
export {
  DocumentTypeSelect,
  DOCUMENT_TYPE_LABEL_FALLBACK,
  DOCUMENT_TYPE_UNKNOWN_LABEL,
} from './components/document-type-select';
export { useOrderInvoiceQuery } from './hooks/use-order-invoice-query';
export { useInvoiceQuery } from './hooks/use-invoice-query';
export { useIssueInvoiceMutation } from './hooks/use-issue-invoice-mutation';
export {
  CorrectionLinePicker,
  type CorrectionLinePickerProps,
} from './components/correction-line-picker';
export {
  CorrectionReasonField,
  useCorrectionReason,
  CORRECTION_REASON_MAX_LENGTH,
  type CorrectionReasonState,
  type CorrectionReasonFieldProps,
} from './components/correction-reason-field';
export {
  CorrectionLineGrid,
  type CorrectionLineGridProps,
  type CorrectionSuggestedLine,
} from './components/correction-line-grid';
export {
  useInvoiceContentQuery,
  isContentUnavailable,
  type InvoiceContentQueryResult,
} from './hooks/use-invoice-content-query';
export { useInvoicesQuery } from './hooks/use-invoices-query';
export { useRetryInvoicesMutation } from './hooks/use-retry-invoices-mutation';
export { useBulkIssueInvoicesMutation } from './hooks/use-bulk-issue-invoices-mutation';
export {
  useIssueCorrectionMutation,
  type IssueCorrectionVariables,
} from './hooks/use-issue-correction-mutation';
export { useResendToAuthorityMutation } from './hooks/use-resend-to-authority-mutation';
export { useRegulatoryConfirmationPreview } from './hooks/use-regulatory-confirmation-preview';
export type { ConfirmationPreviewKind } from './hooks/use-regulatory-confirmation-preview';
export { useRegulatoryConfirmationDownload } from './hooks/use-regulatory-confirmation-download';
export { useInvoiceSourceDocument } from './hooks/use-invoice-source-document';
export { useInvoiceVerificationLinkQuery } from './hooks/use-invoice-verification-link-query';
export { useInvoiceRenderedDocumentDownload } from './hooks/use-invoice-rendered-document-download';
export {
  useSendInvoiceEmailMutation,
  type SendInvoiceEmailVariables,
} from './hooks/use-send-invoice-email-mutation';
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
export {
  isMissingNumberingSeriesError,
  isConnectionSetupIncompleteError,
  isConnectionSettingError,
  readConnectionSettingErrorCode,
  type ConnectionSettingFailureCode,
  isCapabilityDisabledError,
  resolveIssueErrorMessage,
  readAcknowledgementRequest,
  type AcknowledgementRequest,
} from './lib/issue-error-message';
export {
  useWarningAcknowledgement,
  type WarningAcknowledgement,
} from './components/acknowledge-warning-dialog';
export {
  deriveInvoiceDisplayStatus,
  canRetryInvoice,
  resolveFailureCopy,
  isConnectionSettingFailureCode,
} from './lib/derive-invoice-display';
export {
  isPrimaryInvoicingConnection,
  selectInvoicingCandidates,
  selectReauthInvoicingConnections,
  resolveIssuingConnection,
  resolveIssuableConnection,
  type InvoicingConnectionLike,
  type IssuingConnectionResolution,
} from './lib/resolve-invoicing-connection';
export {
  resolveSalesDocumentBlockCopy,
  resolveMissingTaxRateScope,
  type SalesDocumentBlockCopy,
  type SalesDocumentBlockCopyKind,
  type RateLessLine,
} from './lib/sales-document-block-copy';
export { resolveInvoiceLifecycleSteps } from './lib/invoice-lifecycle-steps';
// #2254: the frontend mirror of core's `splitShippingAcrossRates`, guarded by
// `scripts/check-shipping-tax-split-mirror.mjs`. Exported so the order-detail
// sales-document panel can preview the shipping line(s) the document will carry.
export {
  splitShippingAcrossRates,
  minorUnitExponentFor,
  type ShippingSplitLine,
  type ShippingSplitPart,
} from './lib/shipping-tax-split';
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
  IssueInvoiceOptions,
  IssueInvoiceAnnotationsInput,
  IssueInvoiceAdditionalPartyInput,
  IssueInvoiceLineClassificationInput,
  IssuedDocumentContent,
  IssuedDocumentLine,
  InvoiceEmailLocale,
  SendInvoiceEmailInput,
  SendInvoiceEmailResult,
} from './api/invoicing.types';
