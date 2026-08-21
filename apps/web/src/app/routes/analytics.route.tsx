import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

export const analyticsRoute: RouteObject = {
  path: 'analytics',
  handle: { crumb: { group: 'Operations', title: 'Analytics' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { AnalyticsPage } = await import('../../pages/analytics/analytics-page');
    return { Component: AnalyticsPage };
  },
};
