/**
 * Polish shape check
 *
 * Compiled by `tsc -b`, never imported at runtime (Polish files load lazily,
 * one per namespace, see `shared/i18n/messages.ts`). Fails the type-check when
 * a `pl/<namespace>.json` does not fit the shape its English file declares: a
 * string where English has a section or the reverse, or a key English lacks.
 * A missing key is not an error (the type is partial, #3891).
 *
 * Lists every `pl/*.json`; `scripts/check-locales.mjs` fails when a file is
 * missing here.
 *
 * @module locales
 */
import type { PolishCopy } from '../../shared/i18n/copy.types';
import type { Messages } from '../../shared/i18n/messages';
import adapters from './adapters.json';
import aiProviderSettings from './ai-provider-settings.json';
import allegroCore from './allegro-core.json';
import analytics from './analytics.json';
import app from './app.json';
import auth from './auth.json';
import automation from './automation.json';
import bench from './bench.json';
import buyerEmails from './buyer-emails.json';
import connections from './connections.json';
import content from './content.json';
import currencySettings from './currency-settings.json';
import cursors from './cursors.json';
import customers from './customers.json';
import deliveryOnDocuments from './delivery-on-documents.json';
import demo from './demo.json';
import devUi from './dev-ui.json';
import fiscalization from './fiscalization.json';
import format from './format.json';
import fulfillment from './fulfillment.json';
import fulfillmentAuthority from './fulfillment-authority.json';
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
import promptTemplates from './prompt-templates.json';
import returns from './returns.json';
import salesDocuments from './sales-documents.json';
import settings from './settings.json';
import shipments from './shipments.json';
import syncJobs from './sync-jobs.json';
import ui from './ui.json';
import users from './users.json';
import webhookDeliveries from './webhook-deliveries.json';

const polish: PolishCopy<Messages> = {
  adapters,
  'ai-provider-settings': aiProviderSettings,
  'allegro-core': allegroCore,
  analytics,
  app,
  auth,
  automation,
  bench,
  'buyer-emails': buyerEmails,
  connections,
  content,
  'currency-settings': currencySettings,
  cursors,
  customers,
  'delivery-on-documents': deliveryOnDocuments,
  demo,
  'dev-ui': devUi,
  fiscalization,
  format,
  fulfillment,
  'fulfillment-authority': fulfillmentAuthority,
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
  returns,
  'sales-documents': salesDocuments,
  settings,
  shipments,
  'sync-jobs': syncJobs,
  ui,
  users,
  'webhook-deliveries': webhookDeliveries,
};
void polish;
