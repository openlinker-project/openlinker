/**
 * Subiekt GT plugin messages
 *
 * Registers the `subiekt-gt` translation namespace (ADR-081) from the plugin's own
 * `locales/en.json`. Polish arrives with the batch D translation issue, as a
 * `pl` loader here.
 *
 * @module plugins/subiekt-gt
 */
import { definePluginMessages } from '../../shared/i18n';
import en from './locales/en.json';

export const subiektGtMessages = definePluginMessages('subiekt-gt', { messages: en });
export const useSubiektGtMessages = subiektGtMessages.useMessages;
export const getSubiektGtMessages = subiektGtMessages.getMessages;
