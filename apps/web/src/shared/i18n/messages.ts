/**
 * Messages
 *
 * The translation registry (ADR-081). The application core keeps its copy in
 * one JSON file per language AND namespace - `locales/en/<namespace>.json`,
 * `locales/pl/<namespace>.json` - named after the feature folder (`ui`,
 * `format`, `orders` ...); `locales/en/index.ts` lists them. A plugin brings
 * its own namespace in its own folder through `definePluginMessages`.
 *
 * Each namespace has exactly one home, so nothing is looked up across files.
 * The only fallback is within a namespace: the active language first, then
 * the namespace's base language (English unless a plugin declares another),
 * which is complete by construction.
 *
 * The base language ships in the main bundle; every other language is a
 * dynamic import of that namespace's file alone, loaded by `loadMessages`
 * before it is shown.
 *
 * @module shared/i18n
 */
import { en } from '../../locales/en';
import { mergeOverEnglish } from './merge';
import { pseudoTree } from './pseudo';
import { SOURCE_LOCALE, type SupportedLocale } from './i18n.types';
import type { ResolvedCopy } from './copy.types';

/** The core dictionary, typed from the English files listed in `locales/en/index.ts`. */
export type Messages = typeof en;
export type Namespace = keyof Messages;

export type MessagesLoader = () => Promise<unknown>;

export interface NamespaceEntry {
  /** The language that holds every key of this namespace. */
  readonly baseLocale: SupportedLocale;
  readonly base: Readonly<Record<string, unknown>>;
  readonly loaders: Partial<Record<SupportedLocale, MessagesLoader>>;
}

const registry = new Map<string, NamespaceEntry>();
const loaded = new Map<string, unknown>();
const loadedLocales = new Set<SupportedLocale>();

function cacheKey(locale: SupportedLocale, namespace: string): string {
  return `${locale}:${namespace}`;
}

// One lazy chunk per Polish file, so a language switch fetches each core
// namespace on its own; a namespace with no Polish file keeps its English.
const corePolishFiles = import.meta.glob<{ default: unknown }>('../../locales/pl/*.json');

for (const [namespace, base] of Object.entries(en as Record<string, Record<string, unknown>>)) {
  const loadPolish = corePolishFiles[`../../locales/pl/${namespace}.json`];
  registry.set(namespace, {
    baseLocale: SOURCE_LOCALE,
    base,
    loaders: loadPolish ? { pl: () => loadPolish().then((module) => module.default) } : {},
  });
}

/**
 * Register a namespace that does not live in the core file. Throws on a
 * second registration of the same name, so a plugin can never replace a
 * core namespace or another plugin's.
 */
export function registerNamespace(namespace: string, entry: NamespaceEntry): void {
  if (registry.has(namespace)) {
    throw new Error(`i18n namespace "${namespace}" is already registered`);
  }
  registry.set(namespace, entry);
  if (import.meta.env.DEV && import.meta.env.MODE !== 'test' && loadedLocales.size > 0) {
    console.warn(
      `i18n namespace "${namespace}" was registered after messages loaded; register it at module load so its translations load with the rest.`,
    );
  }
}

/**
 * Load every namespace for one language. Resolves once each translation is
 * merged over its base, so the caller can switch language without a frame of
 * missing copy. A namespace without a loader for the language keeps its base.
 */
export async function loadMessages(locale: SupportedLocale): Promise<void> {
  await Promise.all(
    [...registry].map(async ([namespace, entry]) => {
      const key = cacheKey(locale, namespace);
      if (locale === entry.baseLocale || loaded.has(key)) return;
      const load = entry.loaders[locale];
      if (!load) return;
      loaded.set(key, mergeOverEnglish(entry.base, await load()));
    }),
  );
  loadedLocales.add(locale);
}

/**
 * True when every registered namespace that has a translation for the
 * language holds it, so switching to it shows no base-language gaps that a
 * load would fill.
 */
export function isMessagesLoaded(locale: SupportedLocale): boolean {
  for (const [namespace, entry] of registry) {
    if (locale !== entry.baseLocale && entry.loaders[locale] && !loaded.has(cacheKey(locale, namespace))) {
      return false;
    }
  }
  return true;
}

/**
 * One namespace for one language: the merged translation when loaded, the
 * base language otherwise. The returned object is stable until the language
 * changes, so it is safe as a hook dependency.
 */
export function namespaceFor(locale: SupportedLocale, namespace: string): unknown {
  const entry = registry.get(namespace);
  if (entry === undefined) throw new Error(`i18n namespace "${namespace}" is not registered`);
  return loaded.get(cacheKey(locale, namespace)) ?? entry.base;
}

/**
 * One core namespace for an explicit language, typed from its English file. For code
 * that already holds the language it formats in - the shared formatters take
 * it as a parameter so a test can pin it.
 */
export function messagesIn<N extends Namespace>(
  namespace: N,
  locale: SupportedLocale,
): ResolvedCopy<Messages[N]> {
  return namespaceFor(locale, namespace) as ResolvedCopy<Messages[N]>;
}

const pseudo = new Map<string, unknown>();

/**
 * One namespace in the development-only pseudo-language (`?lang=xx`): its
 * base language, every string accented and lengthened. Cached per namespace.
 */
export function pseudoNamespaceFor(namespace: string): unknown {
  let tree = pseudo.get(namespace);
  if (tree === undefined) {
    const entry = registry.get(namespace);
    if (entry === undefined) throw new Error(`i18n namespace "${namespace}" is not registered`);
    tree = pseudoTree(entry.base);
    pseudo.set(namespace, tree);
  }
  return tree;
}

export function registeredNamespaces(): readonly string[] {
  return [...registry.keys()];
}
