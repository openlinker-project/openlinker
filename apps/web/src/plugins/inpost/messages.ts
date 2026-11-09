/**
 * InPost plugin messages
 *
 * Registers the `inpost` translation namespace (ADR-081) from the plugin's own
 * `locales/en.json`. Polish loads lazily from
 * `locales/pl.json`.
 *
 * @module plugins/inpost
 */
import { definePluginMessages } from '../../shared/i18n';
import en from './locales/en.json';

export const inpostMessages = definePluginMessages('inpost', {
  messages: en,
  loaders: { pl: () => import('./locales/pl.json').then((m) => m.default) },
});
export const useInpostMessages = inpostMessages.useMessages;
export const getInpostMessages = inpostMessages.getMessages;
