/**
 * WooCommerce plugin messages
 *
 * Registers the `woocommerce` translation namespace (ADR-081) from the plugin's own
 * `locales/en.json`. Polish loads lazily from
 * `locales/pl.json`.
 *
 * @module plugins/woocommerce
 */
import { definePluginMessages } from '../../shared/i18n';
import en from './locales/en.json';

export const woocommerceMessages = definePluginMessages('woocommerce', {
  messages: en,
  loaders: { pl: () => import('./locales/pl.json').then((m) => m.default) },
});
export const useWoocommerceMessages = woocommerceMessages.useMessages;
export const getWoocommerceMessages = woocommerceMessages.getMessages;
