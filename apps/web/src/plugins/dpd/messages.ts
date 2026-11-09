/**
 * DPD plugin messages
 *
 * Registers the `dpd` translation namespace (ADR-081) from the plugin's own
 * `locales/en.json`. Polish loads lazily from
 * `locales/pl.json`.
 *
 * @module plugins/dpd
 */
import { definePluginMessages } from '../../shared/i18n';
import en from './locales/en.json';

export const dpdMessages = definePluginMessages('dpd', {
  messages: en,
  loaders: { pl: () => import('./locales/pl.json').then((m) => m.default) },
});
export const useDpdMessages = dpdMessages.useMessages;
export const getDpdMessages = dpdMessages.getMessages;
