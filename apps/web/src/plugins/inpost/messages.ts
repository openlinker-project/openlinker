/**
 * InPost plugin messages
 *
 * Registers the `inpost` translation namespace (ADR-081) from the plugin's own
 * `locales/en.json`. Polish arrives with the batch D translation issue, as a
 * `pl` loader here.
 *
 * @module plugins/inpost
 */
import { definePluginMessages } from '../../shared/i18n';
import en from './locales/en.json';

export const inpostMessages = definePluginMessages('inpost', { messages: en });
export const useInpostMessages = inpostMessages.useMessages;
export const getInpostMessages = inpostMessages.getMessages;
