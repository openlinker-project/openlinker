/**
 * definePluginMessages
 *
 * Registers a plugin's own namespace and returns hooks typed from the
 * plugin's base file, so a plugin keeps its translations in its own folder
 * (`plugins/<id>/locales/en.json`) and never extends the core `Messages`
 * type. The base language defaults to English; a market-only module may
 * declare another, and the locale checks then compare against that file.
 *
 * Call it at module load and reference the result from the plugin's
 * `messages` slot, so the namespace is registered before the first
 * `loadMessages`.
 *
 * @module shared/i18n
 */
import { useContext } from 'react';
import { LocaleContext } from './locale-provider';
import { getLocale } from './active-locale';
import { namespaceFor, registerNamespace, type MessagesLoader } from './messages';
import { SOURCE_LOCALE, type SupportedLocale } from './i18n.types';
import type { CopyTree, ResolvedCopy } from './copy.types';

export interface PluginMessagesOptions<T extends CopyTree> {
  readonly messages: T;
  readonly baseLocale?: SupportedLocale;
  readonly loaders?: Partial<Record<SupportedLocale, MessagesLoader>>;
}

export interface PluginMessages<T extends CopyTree> {
  readonly namespace: string;
  readonly useMessages: () => ResolvedCopy<T>;
  readonly getMessages: () => ResolvedCopy<T>;
}

export function definePluginMessages<const T extends CopyTree>(
  namespace: string,
  options: PluginMessagesOptions<T>,
): PluginMessages<T> {
  registerNamespace(namespace, {
    baseLocale: options.baseLocale ?? SOURCE_LOCALE,
    base: options.messages,
    loaders: options.loaders ?? {},
  });
  const read = (locale: SupportedLocale): ResolvedCopy<T> =>
    namespaceFor(locale, namespace) as ResolvedCopy<T>;
  return {
    namespace,
    useMessages: function usePluginMessages(): ResolvedCopy<T> {
      return read(useContext(LocaleContext)?.locale ?? getLocale());
    },
    getMessages: () => read(getLocale()),
  };
}
