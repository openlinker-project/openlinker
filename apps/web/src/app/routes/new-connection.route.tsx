import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

export const newConnectionRoute: RouteObject = {
  path: 'connections/new',
  handle: { crumb: { group: 'platform', page: 'newConnection' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { NewConnectionPage } = await import('../../pages/connections/new-connection-page');
    return { Component: NewConnectionPage };
  },
};
