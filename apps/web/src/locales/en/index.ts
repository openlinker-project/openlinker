/**
 * Core English copy
 *
 * One JSON file per namespace (ADR-081): `locales/en/<namespace>.json`, named
 * after the feature folder it serves. This index is the only list of core
 * namespaces - one import and one entry per file - and the `Messages` type is
 * derived from it. English is the base language and ships in the main bundle.
 *
 * Add a namespace: create `en/<namespace>.json` and add it here (keys sorted).
 * `scripts/check-locales.mjs` fails when a file and this list disagree.
 *
 * @module locales
 */
import adapters from './adapters.json';
import aiProviderSettings from './ai-provider-settings.json';
import allegroCore from './allegro-core.json';
import analytics from './analytics.json';
import app from './app.json';
import auth from './auth.json';
import automation from './automation.json';
import bench from './bench.json';
import bundleReturns from './bundle-returns.json';
import bundles from './bundles.json';
import buyerEmails from './buyer-emails.json';
import connections from './connections.json';
import content from './content.json';
import currencySettings from './currency-settings.json';
import cursors from './cursors.json';
import customers from './customers.json';
import deliveryOnDocuments from './delivery-on-documents.json';
import demo from './demo.json';
import devUi from './dev-ui.json';
import errors from './errors.json';
import fiscalization from './fiscalization.json';
import format from './format.json';
import fulfillment from './fulfillment.json';
import fulfillmentAuthority from './fulfillment-authority.json';
import giftDocuments from './gift-documents.json';
import giftReport from './gift-report.json';
import gifts from './gifts.json';
import inventory from './inventory.json';
import invoicing from './invoicing.json';
import listings from './listings.json';
import login from './login.json';
import loginPageSettings from './login-page-settings.json';
import mailerSettings from './mailer-settings.json';
import mappings from './mappings.json';
import mcpTokens from './mcp-tokens.json';
import omsCore from './oms-core.json';
import orders from './orders.json';
import posthogSettings from './posthog-settings.json';
import priceChanges from './price-changes.json';
import products from './products.json';
import promotions from './promotions.json';
import promptTemplates from './prompt-templates.json';
import returnGifts from './return-gifts.json';
import returns from './returns.json';
import salesDocuments from './sales-documents.json';
import settings from './settings.json';
import shipments from './shipments.json';
import syncJobs from './sync-jobs.json';
import ui from './ui.json';
import users from './users.json';
import webhookDeliveries from './webhook-deliveries.json';

export const en = {
  adapters,
  'ai-provider-settings': aiProviderSettings,
  'allegro-core': allegroCore,
  analytics,
  app,
  auth,
  automation,
  bench,
  'bundle-returns': bundleReturns,
  bundles,
  'buyer-emails': buyerEmails,
  connections,
  content,
  'currency-settings': currencySettings,
  cursors,
  customers,
  'delivery-on-documents': deliveryOnDocuments,
  demo,
  'dev-ui': devUi,
  errors,
  fiscalization,
  format,
  fulfillment,
  'fulfillment-authority': fulfillmentAuthority,
  'gift-documents': giftDocuments,
  'gift-report': giftReport,
  gifts,
  promotions,
  inventory,
  invoicing,
  listings,
  login,
  'login-page-settings': loginPageSettings,
  'mailer-settings': mailerSettings,
  mappings,
  'mcp-tokens': mcpTokens,
  'oms-core': omsCore,
  orders,
  'posthog-settings': posthogSettings,
  'price-changes': priceChanges,
  products,
  'prompt-templates': promptTemplates,
  'return-gifts': returnGifts,
  returns,
  'sales-documents': salesDocuments,
  settings,
  shipments,
  'sync-jobs': syncJobs,
  ui,
  users,
  'webhook-deliveries': webhookDeliveries,
};
