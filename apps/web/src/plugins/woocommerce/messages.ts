/**
 * WooCommerce plugin messages
 *
 * Registers the `woocommerce` translation namespace (ADR-081) from the plugin's own
 * `locales/en.json`. Polish arrives with the batch D translation issue, as a
 * `pl` loader here.
 *
 * @module plugins/woocommerce
 */
import { definePluginMessages } from '../../shared/i18n';
import en from './locales/en.json';

export const woocommerceMessages = definePluginMessages('woocommerce', { messages: en });
export const useWoocommerceMessages = woocommerceMessages.useMessages;
export const getWoocommerceMessages = woocommerceMessages.getMessages;
