/**
 * shared/i18n - public barrel
 *
 * The only import path for translation and locale helpers (ADR-081). Core
 * copy lives in `locales/<lang>.json` and is read with `useMessages`; a
 * plugin brings its own namespace through `definePluginMessages`.
 *
 * @module shared/i18n
 */
export { LocaleProvider } from './locale-provider';
export { useLocale, useActiveLocale, useOptionalLocale } from './use-locale';
export type { UseLocaleResult } from './use-locale';
export { useMessages, getMessages } from './use-messages';
export { loadMessages, isMessagesLoaded, messagesIn } from './messages';
export type { Messages, Namespace, MessagesLoader } from './messages';
export { definePluginMessages } from './define-plugin-messages';
export type { PluginMessages, PluginMessagesOptions } from './define-plugin-messages';
export { interpolate } from './interpolate';
export type { InterpolationParams } from './interpolate';
export { renderRich } from './render-rich';
export type { RichParts } from './render-rich';
export { getLocale } from './active-locale';
export { usePlural } from './use-plural';
export type { PluralFn } from './use-plural';
export { formatPlural, selectPluralForm } from './plural';
export { labelFor } from './label-for';
export { useFormat } from './use-format';
export type { Formatters } from './use-format';
export { useNumberFormat } from './use-number-format';
export { getBcp47Locale } from './locale';
export { LocaleKeyed } from './locale-keyed';
export {
  LocaleCodeValues,
  SOURCE_LOCALE,
  FALLBACK_LOCALE,
  isSupportedLocale,
} from './i18n.types';
export type {
  LocaleCode,
  SupportedLocale,
  LocaleContextValue,
} from './i18n.types';
export type {
  CopyTree,
  EnglishPlural,
  PolishPlural,
  PluralForms,
  PolishCopy,
  ResolvedCopy,
} from './copy.types';
