/**
 * inFakt plugin messages
 *
 * Registers the `infakt` translation namespace (ADR-081) from the plugin's own
 * `locales/en.json`. Polish arrives with the batch D translation issue, as a
 * `pl` loader here.
 *
 * @module plugins/infakt
 */
import { definePluginMessages } from '../../shared/i18n';
import en from './locales/en.json';

export const infaktMessages = definePluginMessages('infakt', { messages: en });
export const useInfaktMessages = infaktMessages.useMessages;
export const getInfaktMessages = infaktMessages.getMessages;
