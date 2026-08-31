import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

/**
 * Post-login landing page. Renders the same `AnalyticsPage` as
 * `analyticsRoute` below — kept as a distinct route object (rather than a
 * `<Navigate>` redirect) so `/` has its own crumb and lazy-route accounting,
 * and existing `/analytics` links/bookmarks keep working unchanged.
 */
export const analyticsIndexRoute: RouteObject = {
  index: true,
  handle: { crumb: { group: 'Operations', title: 'Analytics' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { AnalyticsPage } = await import('../../pages/analytics/analytics-page');
    return { Component: AnalyticsPage };
  },
};

export const analyticsRoute: RouteObject = {
  path: 'analytics',
  handle: { crumb: { group: 'Operations', title: 'Analytics' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { AnalyticsPage } = await import('../../pages/analytics/analytics-page');
    return { Component: AnalyticsPage };
  },
};
