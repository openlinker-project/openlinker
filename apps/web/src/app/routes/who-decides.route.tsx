import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

export const whoDecidesRoute: RouteObject = {
  path: 'settings/who-decides',
  handle: { crumb: { group: 'settings', page: 'whoDecides' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { WhoDecidesPage } = await import('../../pages/settings/who-decides-page');
    return { Component: WhoDecidesPage };
  },
};
