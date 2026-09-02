import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

export const salesDocumentProvidersRoute: RouteObject = {
  path: 'settings/sales-documents/providers',
  handle: {
    crumb: { group: 'Settings', title: 'Connected providers' },
  } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { SalesDocumentProvidersPage } = await import(
      '../../pages/settings/sales-document-providers-page'
    );
    return { Component: SalesDocumentProvidersPage };
  },
};
