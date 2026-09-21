import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

export const salesDocumentsRoute: RouteObject = {
  path: 'settings/sales-documents',
  handle: { crumb: { group: 'Settings', title: 'Document routing' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { SalesDocumentsPage } = await import(
      '../../pages/settings/sales-documents-page'
    );
    return { Component: SalesDocumentsPage };
  },
};
