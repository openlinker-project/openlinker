/**
 * useMessages Hook
 *
 * One core namespace for the active language, typed from its English file (`locales/en/<namespace>.json`):
 * `useMessages('ui').common.retry`. Missing translations fall back to English
 * key by key. Plugins read their own namespace through the hook
 * `definePluginMessages` returns instead. Under the development-only
 * pseudo-language it returns the pseudo-localized English.
 *
 * @module shared/i18n
 */
import { useContext } from 'react';
import { LocaleContext } from './locale-provider';
import { getLocale } from './active-locale';
import { messagesIn, pseudoNamespaceFor, type Messages, type Namespace } from './messages';
import type { ResolvedCopy } from './copy.types';

export function useMessages<N extends Namespace>(namespace: N): ResolvedCopy<Messages[N]> {
  const ctx = useContext(LocaleContext);
  if (ctx?.pseudo) return pseudoNamespaceFor(namespace) as ResolvedCopy<Messages[N]>;
  return messagesIn(namespace, ctx?.locale ?? getLocale());
}

/**
 * The same namespace outside React - zod schemas, formatters, module-level
 * label maps. Reads the language the provider last set.
 */
export function getMessages<N extends Namespace>(namespace: N): ResolvedCopy<Messages[N]> {
  return messagesIn(namespace, getLocale());
}
