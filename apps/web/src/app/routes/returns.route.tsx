/**
 * Returns route (#2335)
 *
 * Top-level `/returns` list. Lazy-loaded page chunk; carries its own breadcrumb
 * (Operations › Returns).
 *
 * @module app/routes
 */
import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

export const returnsRoute: RouteObject = {
  path: 'returns',
  handle: { crumb: { group: 'Operations', title: 'Returns' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { ReturnsListPage } = await import('../../pages/returns/returns-list-page');
    return { Component: ReturnsListPage };
  },
};
