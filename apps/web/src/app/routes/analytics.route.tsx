import { Navigate, type RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

/**
 * Post-login landing page. Analytics owns `/` since #2740.
 */
export const analyticsIndexRoute: RouteObject = {
  index: true,
  handle: { crumb: { group: 'Operations', title: 'Analytics' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { AnalyticsPage } = await import('../../pages/analytics/analytics-page');
    return { Component: AnalyticsPage };
  },
};

/**
 * Legacy `/analytics` URL kept reachable for existing bookmarks and links, as
 * a `<Navigate replace>` shim rather than a second route rendering the same
 * page (the `prompt-templates-legacy-redirects` precedent). Rendering the page
 * twice under two paths would leave the sidebar with no active item on
 * `/analytics` — the "Analytics" nav entry matches `/` with `end: true` — and
 * would duplicate the crumb source for one page.
 */
export const analyticsLegacyRedirectRoute: RouteObject = {
  path: 'analytics',
  element: <Navigate to="/" replace />,
};
