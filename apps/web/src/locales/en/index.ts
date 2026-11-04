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
import allegroCore from './allegro-core.json';
import analytics from './analytics.json';
import app from './app.json';
import auth from './auth.json';
import automation from './automation.json';
import bench from './bench.json';
import connections from './connections.json';
import content from './content.json';
import currencySettings from './currency-settings.json';
import customers from './customers.json';
import demo from './demo.json';
import fiscalization from './fiscalization.json';
import format from './format.json';
import fulfillment from './fulfillment.json';
import fulfillmentAuthority from './fulfillment-authority.json';
import inventory from './inventory.json';
import invoicing from './invoicing.json';
import listings from './listings.json';
import omsCore from './oms-core.json';
import orders from './orders.json';
import priceChanges from './price-changes.json';
import products from './products.json';
import returns from './returns.json';
import salesDocuments from './sales-documents.json';
import shipments from './shipments.json';
import ui from './ui.json';
import users from './users.json';

export const en = {
  adapters,
  'allegro-core': allegroCore,
  analytics,
  app,
  auth,
  automation,
  bench,
  connections,
  content,
  'currency-settings': currencySettings,
  customers,
  demo,
  fiscalization,
  format,
  fulfillment,
  'fulfillment-authority': fulfillmentAuthority,
  inventory,
  invoicing,
  listings,
  'oms-core': omsCore,
  orders,
  'price-changes': priceChanges,
  products,
  returns,
  'sales-documents': salesDocuments,
  shipments,
  ui,
  users,
};
