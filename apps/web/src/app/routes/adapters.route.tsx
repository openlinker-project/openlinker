import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

export const adaptersRoute: RouteObject = {
  path: 'adapters',
  handle: { crumb: { group: 'platform', page: 'adapters' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { AdaptersCatalogPage } = await import('../../pages/adapters/adapters-catalog-page');
    return { Component: AdaptersCatalogPage };
  },
};
