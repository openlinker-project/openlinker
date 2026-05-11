import type { RouteObject } from 'react-router-dom';

export const adaptersRoute: RouteObject = {
  path: 'adapters',
  lazy: async () => {
    const { AdaptersCatalogPage } = await import('../../pages/adapters/adapters-catalog-page');
    return { Component: AdaptersCatalogPage };
  },
};
