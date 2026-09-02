import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

export const insightsRoute: RouteObject = {
  path: 'insights',
  handle: { crumb: { group: 'Operations', title: 'Insights' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { InsightsPage } = await import('../../pages/insights/insights-page');
    return { Component: InsightsPage };
  },
};
