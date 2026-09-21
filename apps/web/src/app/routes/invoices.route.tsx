/**
 * Invoices route (#758; kept live alongside /sales-documents by #3307)
 *
 * `/invoices` STAYS MOUNTED (does NOT redirect to `/sales-documents`,
 * #3306/#3307) — the new merged, kind-aware list at `/sales-documents` has
 * no selection, no `BulkActionBar`, and neither the batch-retry nor the
 * bulk-issue (#1355) mutation, and those two are the documented primary
 * remediation path for a `salesDocumentBlocked` order
 * (`docs/architecture-overview.md` §14 Invoicing). Retiring this route
 * before that capability has an equivalent on the new list would remove the
 * remedy while keeping the alarm (#3309 review, BLOCKING 1). The new list
 * links back here for exactly those actions.
 *
 * `/invoices/:invoiceId` (the DETAIL page) is unchanged: it is the single
 * detail route for an invoice record, reused verbatim by the new list's
 * "View document" link (`SalesDocumentListCell`) rather than duplicated
 * under `/sales-documents/...` with a second param name.
 *
 * @module app/routes
 */
import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

const invoicesListCrumb: RouteCrumbHandle = {
  crumb: { group: 'Operations', title: 'Invoices' },
};

const invoiceDetailCrumb: RouteCrumbHandle = {
  crumb: { group: 'Operations', title: 'Invoice' },
};

export const invoicesRoute: RouteObject = {
  path: 'invoices',
  children: [
    {
      index: true,
      handle: invoicesListCrumb,
      lazy: async () => {
        const { InvoicesListPage } = await import('../../pages/invoicing/invoices-list-page');
        return { Component: InvoicesListPage };
      },
    },
    {
      path: ':invoiceId',
      handle: invoiceDetailCrumb,
      lazy: async () => {
        const { InvoiceDetailPage } = await import('../../pages/invoicing/invoice-detail-page');
        return { Component: InvoiceDetailPage };
      },
    },
  ],
};
