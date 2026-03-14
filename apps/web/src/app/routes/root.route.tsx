import type { RouteObject } from 'react-router-dom';
import { AppShell } from '../../shared/ui/app-shell';
import { allegroCallbackRoute } from './allegro-callback.route';
import { connectionDetailRoute } from './connection-detail.route';
import { connectionsRoute } from './connections.route';
import { dashboardRoute } from './dashboard.route';
import { newConnectionRoute } from './new-connection.route';
import { settingsRoute } from './settings.route';

export const rootRoute: RouteObject = {
  path: '/',
  element: <AppShell />,
  children: [
    dashboardRoute,
    connectionsRoute,
    newConnectionRoute,
    connectionDetailRoute,
    allegroCallbackRoute,
    settingsRoute,
  ],
};
