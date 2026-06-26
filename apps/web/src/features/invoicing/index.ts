/**
 * Invoicing — public surface (#757)
 *
 * Public barrel for the invoicing feature. Cross-feature / page consumers
 * import only from here. Kept narrow (like `orders/index.ts`): the panel, the
 * query/mutation hooks, the query keys, and the transport types. The badges,
 * PDF link, document-type select, and `resolveIssueErrorMessage` stay internal
 * (tests deep-import them directly).
 *
 * Exception: `RegulatoryStatusBadge` is exported so per-provider
 * `invoiceDetailSection` slot components (e.g. `plugins/ksef`) can reuse
 * the neutral badge without duplicating the tone/label mapping.
 *
 * @module apps/web/src/features/invoicing
 */
export { OrderInvoicePanel } from './components/order-invoice-panel';
export { InvoiceTimeline } from './components/invoice-timeline';
export { RegulatoryStatusBadge } from './components/regulatory-status-badge';
export { useOrderInvoiceQuery } from './hooks/use-order-invoice-query';
export { useInvoiceQuery } from './hooks/use-invoice-query';
export { useIssueInvoiceMutation } from './hooks/use-issue-invoice-mutation';
export { useInvoicesQuery } from './hooks/use-invoices-query';
export { useRetryInvoicesMutation } from './hooks/use-retry-invoices-mutation';
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
} from './api/invoicing.types';
