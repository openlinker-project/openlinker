import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

export const pricingSyncRoute: RouteObject = {
  path: 'connections/:connectionId/pricing-sync',
  handle: { crumb: { group: 'Platform', title: 'Connection' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { PricingSyncPage } = await import('../../pages/connections/pricing-sync-page');
    return { Component: PricingSyncPage };
  },
};
