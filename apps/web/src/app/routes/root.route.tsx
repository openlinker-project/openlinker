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
import { analyticsIndexRoute, analyticsLegacyRedirectRoute } from './analytics.route';
import { connectionDetailRoute } from './connection-detail.route';
import { connectionCategoryMappingsRoute } from './connection-category-mappings.route';
import { connectionMappingsRoute } from './connection-mappings.route';
import { editConnectionRoute } from './edit-connection.route';
import { connectionsRoute } from './connections.route';
import { cursorsRoute } from './cursors.route';
import { customersRoute } from './customers.route';
import { devUiRoute } from './dev-ui.route';
import { insightsRoute } from './insights.route';
import { listingsRoute } from './listings.route';
import { aiProviderSettingsRoute } from './ai-provider-settings.route';
import { mcpTokensRoute } from './mcp-tokens.route';
import { invoicesRoute } from './invoices.route';
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
import { automationsRoute } from './automations.route';
import { returnsRoute } from './returns.route';
import { fulfillmentRoute } from './fulfillment.route';
import { operationalSettingsRoute } from './operational-settings.route';
import { salesDocumentsRoute } from './sales-documents.route';
import { whoDecidesRoute } from './who-decides.route';
import { settingsRoute } from './settings.route';
import { shipmentsRoute } from './shipments.route';
import { usersRoute } from './users.route';
import { webhookDeliveriesRoute } from './webhook-deliveries.route';

/**
 * Authenticated route children of `rootRoute`. Exported solely so the
 * route-lazy contract test can walk the full tree; this is NOT a runtime
 * API for other modules to consume. The runtime composition is the
 * `rootRoute.children` array at the bottom of this file.
 */
export const coreChildren: RouteObject[] = [
  analyticsIndexRoute,
  analyticsLegacyRedirectRoute,
  insightsRoute,
  ordersRoute,
  productsRoute,
  cursorsRoute,
  customersRoute,
  listingsRoute,
  shipmentsRoute,
  returnsRoute,
  fulfillmentRoute,
  automationsRoute,
  invoicesRoute,
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
  operationalSettingsRoute,
  salesDocumentsRoute,
  whoDecidesRoute,
  promptTemplatesListRoute,
  promptTemplateDetailRoute,
  promptTemplatesLegacyListRedirectRoute,
  promptTemplateLegacyDetailRedirectRoute,
  aiProviderSettingsRoute,
  mcpTokensRoute,
  usersRoute,
  devUiRoute,
];

const pluginChildren: RouteObject[] = plugins.flatMap((plugin) => plugin.build?.routes ?? []);

export const rootRoute: RouteObject = {
  path: '/',
  element: <AuthenticatedAppLayout />,
  children: [...coreChildren, ...pluginChildren],
};
