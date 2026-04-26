import type { RouteObject } from 'react-router-dom';
import { AuthenticatedAppLayout } from '../layouts/authenticated-app-layout';
import { adaptersRoute } from './adapters.route';
import { allegroCallbackRoute } from './allegro-callback.route';
import { allegroSetupRoute } from './allegro-setup.route';
import { connectionDetailRoute } from './connection-detail.route';
import { connectionCategoryMappingsRoute } from './connection-category-mappings.route';
import { connectionMappingsRoute } from './connection-mappings.route';
import { editConnectionRoute } from './edit-connection.route';
import { connectionsRoute } from './connections.route';
import { cursorsRoute } from './cursors.route';
import { customersRoute } from './customers.route';
import { dashboardRoute } from './dashboard.route';
import { listingsRoute } from './listings.route';
import { aiProviderSettingsRoute } from './ai-provider-settings.route';
import { inventoryRoute } from './inventory.route';
import { jobsLogsRoute } from './jobs-logs.route';
import { newConnectionRoute } from './new-connection.route';
import { prestashopSetupRoute } from './prestashop-setup.route';
import { advancedNewConnectionRoute } from './advanced-new-connection.route';
import { ordersRoute } from './orders.route';
import { productsRoute } from './products.route';
import { promptTemplateDetailRoute } from './prompt-template-detail.route';
import { promptTemplatesListRoute } from './prompt-templates-list.route';
import {
  promptTemplateLegacyDetailRedirectRoute,
  promptTemplatesLegacyListRedirectRoute,
} from './prompt-templates-legacy-redirects.route';
import { settingsRoute } from './settings.route';
import { webhookDeliveriesRoute } from './webhook-deliveries.route';

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
    prestashopSetupRoute,
    advancedNewConnectionRoute,
    allegroSetupRoute,
    connectionDetailRoute,
    connectionCategoryMappingsRoute,
    connectionMappingsRoute,
    editConnectionRoute,
    allegroCallbackRoute,
    jobsLogsRoute,
    webhookDeliveriesRoute,
    settingsRoute,
    promptTemplatesListRoute,
    promptTemplateDetailRoute,
    promptTemplatesLegacyListRedirectRoute,
    promptTemplateLegacyDetailRedirectRoute,
    aiProviderSettingsRoute,
  ],
};
