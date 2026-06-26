/**
 * Invoices route (#758)
 *
 * Registers `/invoices` (the invoices list page). Mirrors
 * `webhook-deliveries.route.tsx` for the nested index + crumb shape.
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
