/**
 * Erli plugin messages
 *
 * Registers the `erli` translation namespace (ADR-081) from the plugin's own
 * `locales/en.json`. Polish arrives with the batch D translation issue, as a
 * `pl` loader here.
 *
 * @module plugins/erli
 */
import { definePluginMessages } from '../../shared/i18n';
import en from './locales/en.json';

export const erliMessages = definePluginMessages('erli', { messages: en });
export const useErliMessages = erliMessages.useMessages;
export const getErliMessages = erliMessages.getMessages;
