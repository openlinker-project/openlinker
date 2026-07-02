/**
 * Invoicing — public surface (#757)
 *
 * Public barrel for the invoicing feature. Cross-feature / page consumers
 * import only from here. Kept narrow (like `orders/index.ts`): the panel, the
 * query/mutation hooks, the query keys, and the transport types. The badges,
 * PDF link, document-type select, and `resolveIssueErrorMessage` stay internal
 * (tests deep-import them directly).
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
export { RegulatoryStatusBadge } from './components/regulatory-status-badge';
export { regCardToneFor, type RegCardTone } from './lib/derive-invoice-display';
export { useOrderInvoiceQuery } from './hooks/use-order-invoice-query';
export { useInvoiceQuery } from './hooks/use-invoice-query';
export { useIssueInvoiceMutation } from './hooks/use-issue-invoice-mutation';
export { useInvoicesQuery } from './hooks/use-invoices-query';
export { useRetryInvoicesMutation } from './hooks/use-retry-invoices-mutation';
export {
  useIssueCorrectionMutation,
  type IssueCorrectionVariables,
} from './hooks/use-issue-correction-mutation';
export { useKsefUpoPreview } from './hooks/use-ksef-upo-preview';
export type { UpoPreviewKind } from './hooks/use-ksef-upo-preview';
export { useKsefUpoDownload } from './hooks/use-ksef-upo-download';
export { useKsefFa3 } from './hooks/use-ksef-fa3';
export { useInvoiceRenderedDocumentDownload } from './hooks/use-invoice-rendered-document-download';
export { invoicingQueryKeys } from './api/invoicing.query-keys';
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
  CorrectionLineInput,
  IssueCorrectionInput,
} from './api/invoicing.types';
