import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

export const dashboardRoute: RouteObject = {
  index: true,
  handle: { crumb: { group: 'Operations', title: 'Dashboard' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { DashboardPage } = await import('../../pages/dashboard/dashboard-page');
    return { Component: DashboardPage };
  },
};
