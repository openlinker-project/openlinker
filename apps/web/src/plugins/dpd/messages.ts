/**
 * DPD plugin messages
 *
 * Registers the `dpd` translation namespace (ADR-081) from the plugin's own
 * `locales/en.json`. Polish arrives with the batch D translation issue, as a
 * `pl` loader here.
 *
 * @module plugins/dpd
 */
import { definePluginMessages } from '../../shared/i18n';
import en from './locales/en.json';

export const dpdMessages = definePluginMessages('dpd', { messages: en });
export const useDpdMessages = dpdMessages.useMessages;
export const getDpdMessages = dpdMessages.getMessages;
