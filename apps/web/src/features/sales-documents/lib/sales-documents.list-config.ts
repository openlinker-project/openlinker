/**
 * Sales Documents List Registry
 *
 * What the merged Sales documents list declares to the saved-views engine
 * (#4241). The backend list is keyset-paginated and ordered newest-first with
 * no sort parameter, so the registry offers no sorts (`sorts: []`) and no
 * column sorts: a stored sort would claim an order the API cannot deliver.
 * A view carries filters and columns only; the cursor never belongs to a view.
 *
 * @module apps/web/src/features/sales-documents/lib
 */
import type { ReactNode } from 'react';
import { withColumnLayout } from '../../saved-views';
import type { ListRegistry } from '../../saved-views';
import type { SalesDocumentListItem } from '../api/sales-document-list.types';

export const SALES_DOCUMENTS_PAGE_KEY = 'sales-documents';

export interface SalesDocumentsListCopy {
  columns: { order: string; kind: string; status: string; amount: string; connection: string; created: string };
  views: {
    lockedDescription: string;
    systemViews: { all: string; failed: string; fiscalReceipts: string; invoices: string };
  };
}

export interface SalesDocumentsListRenderers {
  order: (row: SalesDocumentListItem) => ReactNode;
  kind: (row: SalesDocumentListItem) => ReactNode;
  status: (row: SalesDocumentListItem) => ReactNode;
  amount: (row: SalesDocumentListItem) => ReactNode;
  connection: (row: SalesDocumentListItem) => ReactNode;
  created: (row: SalesDocumentListItem) => ReactNode;
}

export interface SalesDocumentsFilterValidators {
  isKind: (raw: string) => boolean;
  isTaxId: (raw: string) => boolean;
}

export function createSalesDocumentsListRegistry(
  copy: SalesDocumentsListCopy,
  render: SalesDocumentsListRenderers,
  valid: SalesDocumentsFilterValidators,
): ListRegistry<SalesDocumentListItem> {
  return {
    pageKey: SALES_DOCUMENTS_PAGE_KEY,
    customViews: false,
    locked: {
      id: 'orderId',
      label: copy.columns.order,
      description: copy.views.lockedDescription,
      header: copy.columns.order,
      render: render.order,
    },
    columns: withColumnLayout([
      { id: 'kind', label: copy.columns.kind, defaultVisible: true, header: copy.columns.kind, render: render.kind },
      { id: 'status', label: copy.columns.status, defaultVisible: true, header: copy.columns.status, render: render.status },
      { id: 'amount', label: copy.columns.amount, defaultVisible: true, header: copy.columns.amount, render: render.amount },
      {
        id: 'connection',
        label: copy.columns.connection,
        defaultVisible: true,
        header: copy.columns.connection,
        render: render.connection,
      },
      { id: 'createdAt', label: copy.columns.created, defaultVisible: true, header: copy.columns.created, render: render.created },
    ], { lines: { orderId: 2 }, hideBelow: { connection: 1024 } }),
    // `search` is the moment's text and a stripped non-view param; `cursor` is position, never a filter.
    filters: [
      { key: 'kind', parse: valid.isKind },
      { key: 'status' },
      { key: 'connectionId' },
      { key: 'taxId', parse: valid.isTaxId },
      { key: 'issuedFrom' },
      { key: 'issuedTo' },
    ],
    sorts: [],
    defaultSort: { key: 'createdAt', dir: 'desc' },
    systemViews: [
      { id: 'all', name: copy.views.systemViews.all, query: '' },
      { id: 'invoices', name: copy.views.systemViews.invoices, query: 'kind=invoice' },
      { id: 'fiscal-receipts', name: copy.views.systemViews.fiscalReceipts, query: 'kind=fiscal-receipt' },
      { id: 'failed', name: copy.views.systemViews.failed, query: 'status=failed', tone: 'error' },
    ],
  };
}
