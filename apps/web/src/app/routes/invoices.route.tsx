/**
 * Invoices route (#758, redirected to /sales-documents by #3307)
 *
 * `/invoices` (the LIST) is retired in favour of the merged, kind-aware
 * `/sales-documents` (#3306/#3307) — this index redirects there rather than
 * 404ing or duplicating the list. `/invoices/:invoiceId` (the DETAIL page)
 * stays mounted at its original path: it is the single, unchanged detail
 * route for an invoice record, reused verbatim by the new list's
 * "View document" link (`SalesDocumentListCell`) rather than duplicated
 * under `/sales-documents/...` with a second param name.
 *
 * @module app/routes
 */
import { Navigate, type RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

const invoiceDetailCrumb: RouteCrumbHandle = {
  crumb: { group: 'Operations', title: 'Invoice' },
};

export const invoicesRoute: RouteObject = {
  path: 'invoices',
  children: [
    {
      index: true,
      element: <Navigate to="/sales-documents" replace />,
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
