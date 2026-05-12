import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

export const editConnectionRoute: RouteObject = {
  path: 'connections/:connectionId/edit',
  handle: { crumb: { group: 'Platform', title: 'Connection' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { EditConnectionPage } = await import(
      '../../pages/connections/edit-connection-page'
    );
    return { Component: EditConnectionPage };
  },
};
