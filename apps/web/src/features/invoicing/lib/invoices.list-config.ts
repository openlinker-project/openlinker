/**
 * Invoices list config (#4241)
 *
 * What the Invoices list declares to the saved-views engine: the filters a view
 * may carry, the built-in views (the triage queues of the prototype) and the
 * column registry. The API has no sort for invoices, so the list declares none
 * and the engine keeps `sort` out of the address.
 *
 * Cell renderers belong to the page, so the registry is a factory taking them.
 *
 * @module apps/web/src/features/invoicing/lib
 */
import type { ReactNode } from 'react';
import type { ListRegistry, SystemViewDef } from '../../saved-views';
import { withColumnLayout } from '../../saved-views';
import {
  InvoiceStatusValues,
  RegulatoryStatusValues,
  type InvoiceRecord,
} from '../api/invoicing.types';

/** Values of the `taxId` filter the API accepts. */
export const INVOICE_TAX_ID_VALUES = ['with', 'without'] as const;

/** Text lines the stacked cells render at their tallest, for the loading skeleton. */
const INVOICE_COLUMN_LINES: Readonly<Record<string, number>> = { orderId: 2 };

/** Breakpoints the table already hid these columns at; the registry has none, so the page re-applies them. */
const INVOICE_COLUMN_HIDE_BELOW: Readonly<Record<string, 480 | 768 | 1024 | 1280>> = {
  regulatoryStatus: 1024,
  clearanceRef: 1024,
  buyerTaxId: 1024,
  connection: 1024,
};

export interface InvoicesListConfigInput {
  labels: {
    order: string;
    orderFields: string;
    documentType: string;
    documentFields: string;
    status: string;
    regulatory: string;
    clearanceRef: string;
    buyerTaxId: string;
    connection: string;
    connectionFields: string;
    issuedAt: string;
  };
  viewNames: { all: string; failed: string; rejected: string; awaiting: string; noTaxId: string };
  headers: {
    order: ReactNode;
    documentType: ReactNode;
    status: ReactNode;
    regulatory: ReactNode;
    clearanceRef: ReactNode;
    buyerTaxId: ReactNode;
    connection: ReactNode;
    issuedAt: ReactNode;
  };
  cells: {
    order: (row: InvoiceRecord) => ReactNode;
    documentType: (row: InvoiceRecord) => ReactNode;
    status: (row: InvoiceRecord) => ReactNode;
    regulatory: (row: InvoiceRecord) => ReactNode;
    clearanceRef: (row: InvoiceRecord) => ReactNode;
    buyerTaxId: (row: InvoiceRecord) => ReactNode;
    connection: (row: InvoiceRecord) => ReactNode;
    issuedAt: (row: InvoiceRecord) => ReactNode;
  };
}

export function invoicesSystemViews(names: InvoicesListConfigInput['viewNames']): SystemViewDef[] {
  return [
    { id: 'all', name: names.all, query: '' },
    { id: 'failed', name: names.failed, query: 'status=failed', tone: 'error' },
    { id: 'rejected', name: names.rejected, query: 'regulatoryStatus=rejected', tone: 'error' },
    { id: 'awaiting', name: names.awaiting, query: 'regulatoryStatus=pending-submission', tone: 'warning' },
    { id: 'no-tax-id', name: names.noTaxId, query: 'taxId=without' },
  ];
}

export function createInvoicesListRegistry(input: InvoicesListConfigInput): ListRegistry<InvoiceRecord> {
  const { labels, headers, cells } = input;
  return {
    pageKey: 'invoices',
    locked: {
      id: 'orderId',
      label: labels.order,
      description: labels.orderFields,
      header: headers.order,
      render: cells.order,
    },
    columns: withColumnLayout([
      { id: 'documentType', label: labels.documentType, description: labels.documentFields, defaultVisible: true, header: headers.documentType, render: cells.documentType },
      { id: 'status', label: labels.status, defaultVisible: true, header: headers.status, render: cells.status },
      { id: 'regulatoryStatus', label: labels.regulatory, defaultVisible: true, header: headers.regulatory, render: cells.regulatory },
      { id: 'clearanceRef', label: labels.clearanceRef, defaultVisible: true, header: headers.clearanceRef, render: cells.clearanceRef },
      { id: 'buyerTaxId', label: labels.buyerTaxId, defaultVisible: true, header: headers.buyerTaxId, render: cells.buyerTaxId },
      { id: 'connection', label: labels.connection, description: labels.connectionFields, defaultVisible: true, header: headers.connection, render: cells.connection },
      { id: 'issuedAt', label: labels.issuedAt, defaultVisible: true, header: headers.issuedAt, render: cells.issuedAt },
    ], { hideBelow: INVOICE_COLUMN_HIDE_BELOW, lines: INVOICE_COLUMN_LINES }),
    filters: [
      { key: 'status', parse: (raw) => (InvoiceStatusValues as readonly string[]).includes(raw) },
      { key: 'regulatoryStatus', parse: (raw) => (RegulatoryStatusValues as readonly string[]).includes(raw) },
      { key: 'taxId', parse: (raw) => (INVOICE_TAX_ID_VALUES as readonly string[]).includes(raw) },
      { key: 'connectionId' },
      { key: 'issuedFrom' },
      { key: 'issuedTo' },
    ],
    // The API returns the newest first and offers no other order, so the engine offers none and keeps `sort` out of the address.
    sorts: [],
    defaultSort: { key: 'issuedAt', dir: 'desc' },
    systemViews: invoicesSystemViews(input.viewNames),
    pinned: ['all', 'failed', 'rejected', 'awaiting', 'no-tax-id'],
    lockedViewIds: ['all', 'failed'],
  };
}
