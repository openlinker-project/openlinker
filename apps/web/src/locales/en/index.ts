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
import app from './app.json';
import auth from './auth.json';
import demo from './demo.json';
import format from './format.json';
import ui from './ui.json';
import users from './users.json';

export const en = {
  app,
  auth,
  demo,
  format,
  ui,
  users,
};
