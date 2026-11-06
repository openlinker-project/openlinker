/**
 * Shoper plugin messages
 *
 * Registers the `shoper` translation namespace (ADR-081) from the plugin's own
 * `locales/en.json`. Polish arrives with the batch D translation issue, as a
 * `pl` loader here.
 *
 * @module plugins/shoper
 */
import { definePluginMessages } from '../../shared/i18n';
import en from './locales/en.json';

export const shoperMessages = definePluginMessages('shoper', { messages: en });
export const useShoperMessages = shoperMessages.useMessages;
export const getShoperMessages = shoperMessages.getMessages;
