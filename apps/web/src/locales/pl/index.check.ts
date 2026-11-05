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
import content from './content.json';
import currencySettings from './currency-settings.json';
import customers from './customers.json';
import demo from './demo.json';
import format from './format.json';
import listings from './listings.json';
import orders from './orders.json';
import priceChanges from './price-changes.json';
import products from './products.json';
import ui from './ui.json';
import users from './users.json';

const polish: PolishCopy<Messages> = {
  app,
  auth,
  content,
  'currency-settings': currencySettings,
  customers,
  demo,
  format,
  listings,
  orders,
  'price-changes': priceChanges,
  products,
  ui,
  users,
};
void polish;
