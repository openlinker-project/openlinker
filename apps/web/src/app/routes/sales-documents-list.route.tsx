/**
 * Sales documents list route (#3307)
 *
 * Registers `/sales-documents` (the merged, operator-facing invoice +
 * fiscal-receipt list, #3306) and `/sales-documents/fiscal-receipt/:recordId`
 * (the fiscal-receipt detail page — the invoice detail page keeps its
 * existing `/invoices/:id` route, see `invoices.route.tsx`). Mirrors
 * `webhook-deliveries.route.tsx` for the nested index + crumb shape.
 *
 * Distinct file and export name from `sales-documents.route.tsx`, which is
 * the UNRELATED `/settings/sales-documents` document-routing CONFIGURATION
 * page (titled "Document routing" as of this same change, precisely to stop
 * the two pages sharing one name) — the two must never collide.
 *
 * @module app/routes
 */
import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

const salesDocumentsListCrumb: RouteCrumbHandle = {
  crumb: { group: 'Operations', title: 'Sales documents' },
};

const fiscalReceiptDetailCrumb: RouteCrumbHandle = {
  crumb: { group: 'Operations', title: 'Fiscal receipt' },
};

export const salesDocumentsListRoute: RouteObject = {
  path: 'sales-documents',
  children: [
    {
      index: true,
      handle: salesDocumentsListCrumb,
      lazy: async () => {
        const { SalesDocumentsListPage } = await import(
          '../../pages/sales-documents/sales-documents-list-page'
        );
        return { Component: SalesDocumentsListPage };
      },
    },
    {
      path: 'fiscal-receipt/:recordId',
      handle: fiscalReceiptDetailCrumb,
      lazy: async () => {
        const { FiscalReceiptDetailPage } = await import(
          '../../pages/sales-documents/fiscal-receipt-detail-page'
        );
        return { Component: FiscalReceiptDetailPage };
      },
    },
  ],
};
