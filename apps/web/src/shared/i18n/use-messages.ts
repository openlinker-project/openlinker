/**
 * useMessages Hook
 *
 * One core namespace for the active language, typed from en.json:
 * `useMessages('ui').common.retry`. Missing translations fall back to English
 * key by key. Plugins read their own namespace through the hook
 * `definePluginMessages` returns instead.
 *
 * @module shared/i18n
 */
import { useContext } from 'react';
import { LocaleContext } from './locale-provider';
import { getLocale } from './active-locale';
import { namespaceFor, type Messages, type Namespace } from './messages';
import type { ResolvedCopy } from './copy.types';

export function useMessages<N extends Namespace>(namespace: N): ResolvedCopy<Messages[N]> {
  const ctx = useContext(LocaleContext);
  return namespaceFor(ctx?.locale ?? getLocale(), namespace) as ResolvedCopy<Messages[N]>;
}

/**
 * The same namespace outside React - zod schemas, formatters, module-level
 * label maps. Reads the language the provider last set.
 */
export function getMessages<N extends Namespace>(namespace: N): ResolvedCopy<Messages[N]> {
  return namespaceFor(getLocale(), namespace) as ResolvedCopy<Messages[N]>;
}
