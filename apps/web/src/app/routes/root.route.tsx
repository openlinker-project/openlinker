import type { RouteObject } from 'react-router-dom';
import { AuthenticatedAppLayout } from '../layouts/authenticated-app-layout';
import { adaptersRoute } from './adapters.route';
import { allegroCallbackRoute } from './allegro-callback.route';
import { allegroSetupRoute } from './allegro-setup.route';
import { automationsRoute } from './automations.route';
import { connectionDetailRoute } from './connection-detail.route';
import { editConnectionRoute } from './edit-connection.route';
import { connectionsRoute } from './connections.route';
import { cursorsRoute } from './cursors.route';
import { customersRoute } from './customers.route';
import { dashboardRoute } from './dashboard.route';
import { invoicesRoute } from './invoices.route';
import { listingsRoute } from './listings.route';
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
    cursorsRoute,
    customersRoute,
    listingsRoute,
    connectionsRoute,
    adaptersRoute,
    newConnectionRoute,
    allegroSetupRoute,
    connectionDetailRoute,
    editConnectionRoute,
    allegroCallbackRoute,
    jobsLogsRoute,
    automationsRoute,
    shippingRoute,
    invoicesRoute,
    settingsRoute,
  ],
};
