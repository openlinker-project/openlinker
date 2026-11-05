/**
 * Polish shape check
 *
 * Compiled by `tsc -b`, never imported at runtime (Polish files load lazily,
 * one per namespace, see `shared/i18n/messages.ts`). Fails the type-check when
 * a `pl/<namespace>.json` does not fit the shape its English file declares: a
 * string where English has a section, a plural missing its Polish forms, or a
 * key English lacks.
 *
 * Lists every `pl/*.json`; `scripts/check-locales.mjs` fails when a file is
 * missing here.
 *
 * @module locales
 */
import type { PolishCopy } from '../../shared/i18n/copy.types';
import type { Messages } from '../../shared/i18n/messages';
import app from './app.json';
import auth from './auth.json';
import automation from './automation.json';
import bench from './bench.json';
import content from './content.json';
import currencySettings from './currency-settings.json';
import customers from './customers.json';
import demo from './demo.json';
import format from './format.json';
import fulfillment from './fulfillment.json';
import fulfillmentAuthority from './fulfillment-authority.json';
import inventory from './inventory.json';
import listings from './listings.json';
import omsCore from './oms-core.json';
import orders from './orders.json';
import priceChanges from './price-changes.json';
import products from './products.json';
import returns from './returns.json';
import shipments from './shipments.json';
import ui from './ui.json';
import users from './users.json';

const polish: PolishCopy<Messages> = {
  app,
  auth,
  automation,
  bench,
  content,
  'currency-settings': currencySettings,
  customers,
  demo,
  format,
  fulfillment,
  'fulfillment-authority': fulfillmentAuthority,
  inventory,
  listings,
  'oms-core': omsCore,
  orders,
  'price-changes': priceChanges,
  products,
  returns,
  shipments,
  ui,
  users,
};
void polish;
