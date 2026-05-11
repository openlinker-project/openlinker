/**
 * Root authenticated route
 *
 * Composes the operator-facing route tree: a fixed core set + every route
 * contributed by the plugin registry. React Router resolves matches by path
 * specificity, not array position, so appending plugin routes is safe — a
 * plugin can only "shadow" a core path by declaring an identical path.
 *
 * @module app/routes
 * @see apps/web/src/plugins/index.ts — single edit point for plugin routes
 */
import type { RouteObject } from 'react-router-dom';

import { plugins } from '../../plugins';
import { AuthenticatedAppLayout } from '../layouts/authenticated-app-layout';
import { adaptersRoute } from './adapters.route';
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

const coreChildren: RouteObject[] = [
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
  advancedNewConnectionRoute,
  connectionDetailRoute,
  connectionCategoryMappingsRoute,
  connectionMappingsRoute,
  editConnectionRoute,
  jobsLogsRoute,
  webhookDeliveriesRoute,
  settingsRoute,
  promptTemplatesListRoute,
  promptTemplateDetailRoute,
  promptTemplatesLegacyListRedirectRoute,
  promptTemplateLegacyDetailRedirectRoute,
  aiProviderSettingsRoute,
];

const pluginChildren: RouteObject[] = plugins.flatMap((plugin) => plugin.routes ?? []);

export const rootRoute: RouteObject = {
  path: '/',
  element: <AuthenticatedAppLayout />,
  children: [...coreChildren, ...pluginChildren],
};
