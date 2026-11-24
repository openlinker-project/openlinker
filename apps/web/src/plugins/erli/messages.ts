/**
 * Erli plugin messages
 *
 * Registers the `erli` translation namespace (ADR-081) from the plugin's own
 * `locales/en.json`. Polish loads lazily from
 * `locales/pl.json`.
 *
 * @module plugins/erli
 */
import { definePluginMessages } from '../../shared/i18n';
import en from './locales/en.json';

export const erliMessages = definePluginMessages('erli', {
  messages: en,
  loaders: { pl: () => import('./locales/pl.json').then((m) => m.default) },
});
export const useErliMessages = erliMessages.useMessages;
export const getErliMessages = erliMessages.getMessages;
