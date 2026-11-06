/**
 * eParagony plugin messages
 *
 * Registers the `eparagony` translation namespace (ADR-081) from the plugin's own
 * `locales/en.json`. Polish arrives with the batch D translation issue, as a
 * `pl` loader here.
 *
 * @module plugins/eparagony
 */
import { definePluginMessages } from '../../shared/i18n';
import en from './locales/en.json';

export const eparagonyMessages = definePluginMessages('eparagony', { messages: en });
export const useEparagonyMessages = eparagonyMessages.useMessages;
export const getEparagonyMessages = eparagonyMessages.getMessages;
