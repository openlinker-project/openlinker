import type { RouteObject } from 'react-router-dom';

export const dashboardRoute: RouteObject = {
  index: true,
  lazy: async () => {
    const { DashboardPage } = await import('../../pages/dashboard/dashboard-page');
    return { Component: DashboardPage };
  },
};
