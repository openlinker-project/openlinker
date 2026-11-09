/**
 * PrestaShop plugin messages
 *
 * Registers the `prestashop` translation namespace (ADR-081) from the plugin's own
 * `locales/en.json`. Polish loads lazily from
 * `locales/pl.json`.
 *
 * @module plugins/prestashop
 */
import { definePluginMessages } from '../../shared/i18n';
import en from './locales/en.json';

export const prestashopMessages = definePluginMessages('prestashop', {
  messages: en,
  loaders: { pl: () => import('./locales/pl.json').then((m) => m.default) },
});
export const usePrestashopMessages = prestashopMessages.useMessages;
export const getPrestashopMessages = prestashopMessages.getMessages;
