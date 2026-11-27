/**
 * Subiekt GT plugin messages
 *
 * Registers the `subiekt-gt` translation namespace (ADR-081) from the plugin's own
 * `locales/en.json`. Polish loads lazily from
 * `locales/pl.json`.
 *
 * @module plugins/subiekt-gt
 */
import { definePluginMessages } from '../../shared/i18n';
import en from './locales/en.json';

export const subiektGtMessages = definePluginMessages('subiekt-gt', {
  messages: en,
  loaders: { pl: () => import('./locales/pl.json').then((m) => m.default) },
});
export const useSubiektGtMessages = subiektGtMessages.useMessages;
export const getSubiektGtMessages = subiektGtMessages.getMessages;
