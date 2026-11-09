/**
 * eParagony plugin messages
 *
 * Registers the `eparagony` translation namespace (ADR-081) from the plugin's own
 * `locales/en.json`. Polish loads lazily from
 * `locales/pl.json`.
 *
 * @module plugins/eparagony
 */
import { definePluginMessages } from '../../shared/i18n';
import en from './locales/en.json';

export const eparagonyMessages = definePluginMessages('eparagony', {
  messages: en,
  loaders: { pl: () => import('./locales/pl.json').then((m) => m.default) },
});
export const useEparagonyMessages = eparagonyMessages.useMessages;
export const getEparagonyMessages = eparagonyMessages.getMessages;
