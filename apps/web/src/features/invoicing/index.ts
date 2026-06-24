/**
 * Invoicing — public surface (#757)
 *
 * Public barrel for the invoicing feature. Cross-feature / page consumers
 * import only from here. Kept narrow (like `orders/index.ts`): the panel, the
 * query/mutation hooks, the query keys, and the transport types. The badges,
 * PDF link, document-type select, and `resolveIssueErrorMessage` stay internal
 * (tests deep-import them directly).
 *
 * @module apps/web/src/features/invoicing
 */
export { OrderInvoicePanel } from './components/order-invoice-panel';
export { useOrderInvoiceQuery } from './hooks/use-order-invoice-query';
export { useIssueInvoiceMutation } from './hooks/use-issue-invoice-mutation';
export { invoicingQueryKeys } from './api/invoicing.query-keys';
export type {
  InvoiceRecord,
  InvoiceStatus,
  RegulatoryStatus,
  DocumentType,
  IssueInvoiceInput,
} from './api/invoicing.types';
