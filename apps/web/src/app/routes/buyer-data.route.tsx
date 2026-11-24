import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

export const buyerDataRoute: RouteObject = {
  path: 'settings/buyer-data',
  handle: { crumb: { group: 'platform', page: 'buyerData' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { BuyerDataPage } = await import('../../pages/settings/buyer-data-page');
    return { Component: BuyerDataPage };
  },
};
