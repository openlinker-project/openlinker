import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

export const sourcingRulesRoute: RouteObject = {
  path: 'settings/sourcing-rules',
  handle: { crumb: { group: 'platform', page: 'sourcingRules' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { SourcingRulesPage } = await import('../../pages/oms/sourcing-rules-page');
    return { Component: SourcingRulesPage };
  },
};
