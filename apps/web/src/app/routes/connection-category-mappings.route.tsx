import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

export const connectionCategoryMappingsRoute: RouteObject = {
  path: 'connections/:connectionId/mappings/categories',
  handle: { crumb: { group: 'platform', page: 'connection' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { ConnectionCategoryMappingsPage } = await import(
      '../../pages/connections/connection-category-mappings-page'
    );
    return { Component: ConnectionCategoryMappingsPage };
  },
};
