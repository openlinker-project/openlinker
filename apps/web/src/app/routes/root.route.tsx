import type { RouteObject } from 'react-router-dom';
import { AuthenticatedAppLayout } from '../layouts/authenticated-app-layout';
import { allegroCallbackRoute } from './allegro-callback.route';
import { allegroSetupRoute } from './allegro-setup.route';
import { automationsRoute } from './automations.route';
import { connectionDetailRoute } from './connection-detail.route';
import { connectionsRoute } from './connections.route';
import { dashboardRoute } from './dashboard.route';
import { invoicesRoute } from './invoices.route';
import { inventoryRoute } from './inventory.route';
import { jobsLogsRoute } from './jobs-logs.route';
import { newConnectionRoute } from './new-connection.route';
import { ordersRoute } from './orders.route';
import { productsRoute } from './products.route';
import { settingsRoute } from './settings.route';
import { shippingRoute } from './shipping.route';

export const rootRoute: RouteObject = {
  path: '/',
  element: <AuthenticatedAppLayout />,
  children: [
    dashboardRoute,
    ordersRoute,
    productsRoute,
    inventoryRoute,
    connectionsRoute,
    newConnectionRoute,
    allegroSetupRoute,
    connectionDetailRoute,
    allegroCallbackRoute,
    jobsLogsRoute,
    automationsRoute,
    shippingRoute,
    invoicesRoute,
    settingsRoute,
  ],
};
