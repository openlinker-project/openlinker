/**
 * Subiekt nexo plugin messages
 *
 * Registers the `subiekt-nexo` translation namespace (ADR-081) from the plugin's own
 * `locales/en.json`. Polish loads lazily from
 * `locales/pl.json`.
 *
 * @module plugins/subiekt-nexo
 */
import { definePluginMessages } from '../../shared/i18n';
import en from './locales/en.json';

export const subiektNexoMessages = definePluginMessages('subiekt-nexo', {
  messages: en,
  loaders: { pl: () => import('./locales/pl.json').then((m) => m.default) },
});
export const useSubiektNexoMessages = subiektNexoMessages.useMessages;
export const getSubiektNexoMessages = subiektNexoMessages.getMessages;
