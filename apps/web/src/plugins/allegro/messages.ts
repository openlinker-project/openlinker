/**
 * Allegro plugin messages
 *
 * Registers the `allegro` translation namespace (ADR-081) from the plugin's own
 * `locales/en.json`. Polish arrives with the batch D translation issue, as a
 * `pl` loader here.
 *
 * @module plugins/allegro
 */
import { definePluginMessages } from '../../shared/i18n';
import en from './locales/en.json';

export const allegroMessages = definePluginMessages('allegro', { messages: en });
export const useAllegroMessages = allegroMessages.useMessages;
export const getAllegroMessages = allegroMessages.getMessages;
