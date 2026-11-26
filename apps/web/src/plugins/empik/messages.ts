/**
 * Empik plugin messages
 *
 * Registers the `empik` translation namespace (ADR-081) from the plugin's own
 * `locales/en.json`. Polish loads lazily from `locales/pl.json`.
 *
 * @module plugins/empik
 */
import { definePluginMessages } from '../../shared/i18n';
import en from './locales/en.json';

export const empikMessages = definePluginMessages('empik', {
  messages: en,
  loaders: { pl: () => import('./locales/pl.json').then((m) => m.default) },
});
export const useEmpikMessages = empikMessages.useMessages;
export const getEmpikMessages = empikMessages.getMessages;
