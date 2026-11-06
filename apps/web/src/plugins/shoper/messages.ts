/**
 * Shoper plugin messages
 *
 * Registers the `shoper` translation namespace (ADR-081) from the plugin's own
 * `locales/en.json`. Polish loads lazily from
 * `locales/pl.json`.
 *
 * @module plugins/shoper
 */
import { definePluginMessages } from '../../shared/i18n';
import en from './locales/en.json';

export const shoperMessages = definePluginMessages('shoper', {
  messages: en,
  loaders: { pl: () => import('./locales/pl.json').then((m) => m.default) },
});
export const useShoperMessages = shoperMessages.useMessages;
export const getShoperMessages = shoperMessages.getMessages;
