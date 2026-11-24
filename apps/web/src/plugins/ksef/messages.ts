/**
 * KSeF plugin messages
 *
 * Registers the `ksef` translation namespace (ADR-081) from the plugin's own
 * `locales/en.json`. Polish loads lazily from
 * `locales/pl.json`.
 *
 * @module plugins/ksef
 */
import { definePluginMessages } from '../../shared/i18n';
import en from './locales/en.json';

export const ksefMessages = definePluginMessages('ksef', {
  messages: en,
  loaders: { pl: () => import('./locales/pl.json').then((m) => m.default) },
});
export const useKsefMessages = ksefMessages.useMessages;
export const getKsefMessages = ksefMessages.getMessages;
