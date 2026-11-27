/**
 * Allegro plugin messages
 *
 * Registers the `allegro` translation namespace (ADR-081) from the plugin's own
 * `locales/en.json`. Polish loads lazily from
 * `locales/pl.json`.
 *
 * @module plugins/allegro
 */
import { definePluginMessages } from '../../shared/i18n';
import en from './locales/en.json';

export const allegroMessages = definePluginMessages('allegro', {
  messages: en,
  loaders: { pl: () => import('./locales/pl.json').then((m) => m.default) },
});
export const useAllegroMessages = allegroMessages.useMessages;
export const getAllegroMessages = allegroMessages.getMessages;
