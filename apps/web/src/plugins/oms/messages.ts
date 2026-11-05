/**
 * OMS plugin messages
 *
 * Registers the `oms` translation namespace (ADR-081) from the plugin's own
 * `locales/en.json`. Polish arrives with the batch D translation issue, as a
 * `pl` loader here.
 *
 * @module plugins/oms
 */
import { definePluginMessages } from '../../shared/i18n';
import en from './locales/en.json';

export const omsMessages = definePluginMessages('oms', { messages: en });
export const useOmsMessages = omsMessages.useMessages;
export const getOmsMessages = omsMessages.getMessages;
