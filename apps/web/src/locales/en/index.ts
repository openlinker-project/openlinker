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
import app from './app.json';
import auth from './auth.json';
import automation from './automation.json';
import connections from './connections.json';
import content from './content.json';
import currencySettings from './currency-settings.json';
import customers from './customers.json';
import demo from './demo.json';
import format from './format.json';
import inventory from './inventory.json';
import listings from './listings.json';
import orders from './orders.json';
import priceChanges from './price-changes.json';
import products from './products.json';
import shipments from './shipments.json';
import ui from './ui.json';
import users from './users.json';

export const en = {
  adapters,
  'allegro-core': allegroCore,
  app,
  auth,
  automation,
  connections,
  content,
  'currency-settings': currencySettings,
  customers,
  demo,
  format,
  inventory,
  listings,
  orders,
  'price-changes': priceChanges,
  products,
  shipments,
  ui,
  users,
};
