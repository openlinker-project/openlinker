/**
 * PrestaShop plugin messages
 *
 * Registers the `prestashop` translation namespace (ADR-081) from the plugin's own
 * `locales/en.json`. Polish arrives with the batch D translation issue, as a
 * `pl` loader here.
 *
 * @module plugins/prestashop
 */
import { definePluginMessages } from '../../shared/i18n';
import en from './locales/en.json';

export const prestashopMessages = definePluginMessages('prestashop', { messages: en });
export const usePrestashopMessages = prestashopMessages.useMessages;
export const getPrestashopMessages = prestashopMessages.getMessages;
