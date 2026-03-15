import type { RouteObject } from 'react-router-dom';
import { DashboardPage } from '../../pages/dashboard/dashboard-page';

export const dashboardRoute: RouteObject = {
  index: true,
  element: <DashboardPage />,
};
