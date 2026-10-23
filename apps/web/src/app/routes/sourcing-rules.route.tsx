import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

export const sourcingRulesRoute: RouteObject = {
  path: 'settings/sourcing-rules',
  handle: { crumb: { group: 'Platform', title: 'Sourcing rules' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { SourcingRulesPage } = await import('../../pages/oms/sourcing-rules-page');
    return { Component: SourcingRulesPage };
  },
};
