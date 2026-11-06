/**
 * KSeF plugin messages
 *
 * Registers the `ksef` translation namespace (ADR-081) from the plugin's own
 * `locales/en.json`. Polish arrives with the batch D translation issue, as a
 * `pl` loader here.
 *
 * @module plugins/ksef
 */
import { definePluginMessages } from '../../shared/i18n';
import en from './locales/en.json';

export const ksefMessages = definePluginMessages('ksef', { messages: en });
export const useKsefMessages = ksefMessages.useMessages;
export const getKsefMessages = ksefMessages.getMessages;
