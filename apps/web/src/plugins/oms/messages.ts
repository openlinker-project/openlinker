/**
 * OMS plugin messages
 *
 * Registers the `oms` translation namespace (ADR-081) from the plugin's own
 * `locales/en.json`. Polish loads lazily from
 * `locales/pl.json`.
 *
 * @module plugins/oms
 */
import { definePluginMessages } from '../../shared/i18n';
import en from './locales/en.json';

export const omsMessages = definePluginMessages('oms', {
  messages: en,
  loaders: { pl: () => import('./locales/pl.json').then((m) => m.default) },
});
export const useOmsMessages = omsMessages.useMessages;
export const getOmsMessages = omsMessages.getMessages;
