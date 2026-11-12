/**
 * Merge over English
 *
 * Lays a translation over the English source of the same shape, key by key.
 * English decides which keys exist; a translation can only replace a value,
 * and an empty or missing string falls back to English, so a partially
 * translated namespace never renders a blank.
 *
 * This is the only place a translation falls back to English, so the
 * development-only missing-translation inspector (#4017) hooks in here: given
 * a `FallbackTagger`, every string that fell back is passed through it before
 * it is stored. Without one the merge is unchanged.
 *
 * @module shared/i18n
 */
import { getBcp47Locale } from './locale';
import { pluralRules } from './intl-cache';
import type { SupportedLocale } from './i18n.types';

export const FallbackKindValues = ['missing', 'empty', 'plural-form'] as const;
/**
 * Why a string shows English: no translated key, an empty translated string,
 * or a plural form the language needs that the translation lacks (the
 * category is then shown in its `other` form, translated or not).
 */
export type FallbackKind = (typeof FallbackKindValues)[number];

export interface FallbackInfo {
  readonly namespace: string;
  readonly path: readonly string[];
  /** The text that is shown instead of a translation. */
  readonly shown: string;
  readonly kind: FallbackKind;
}

export interface FallbackTagger {
  /** Returns the string to store for a value that fell back. */
  tag(info: FallbackInfo): string;
}

export interface MergeInstrumentation {
  readonly tagger: FallbackTagger;
  readonly locale: SupportedLocale;
  readonly namespace: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isEnglishPlural(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === 2 &&
    typeof value.one === 'string' &&
    typeof value.other === 'string'
  );
}

export function mergeOverEnglish(
  source: unknown,
  override: unknown,
  instrumentation?: MergeInstrumentation,
): unknown {
  return merge(source, override, [], instrumentation);
}

function merge(
  source: unknown,
  override: unknown,
  path: readonly string[],
  instrumentation: MergeInstrumentation | undefined,
): unknown {
  if (typeof source === 'string') {
    // An empty translated string is a gap, not a translation: never show a blank.
    if (typeof override === 'string' && override !== '') return override;
    if (instrumentation === undefined) return source;
    return instrumentation.tagger.tag({
      namespace: instrumentation.namespace,
      path,
      shown: source,
      kind: override === '' ? 'empty' : 'missing',
    });
  }
  if (!isRecord(source)) return source;
  const result: Record<string, unknown> = {};
  const patch = isRecord(override) ? override : {};
  for (const key of Object.keys(source)) {
    result[key] = merge(source[key], patch[key], [...path, key], instrumentation);
  }
  // Polish-only plural categories (few, many) have no English counterpart.
  for (const key of Object.keys(patch)) {
    if (!(key in result) && typeof patch[key] === 'string') result[key] = patch[key];
  }
  if (instrumentation !== undefined && isEnglishPlural(source)) {
    tagMissingPluralForms(source, patch, result, path, instrumentation);
  }
  return result;
}

/**
 * A plural category the language needs but the translation lacks renders its
 * `other` form (`selectPluralForm`). Store a tagged copy under that category,
 * so the marker shows exactly when the missing form is the one on screen.
 * When the translation has no `other` either, the category shows English and
 * is reported as a missing key; the copy is built from the untagged English
 * text, so it never carries a marker inside a marker.
 */
function tagMissingPluralForms(
  source: Record<string, unknown>,
  patch: Record<string, unknown>,
  result: Record<string, unknown>,
  path: readonly string[],
  instrumentation: MergeInstrumentation,
): void {
  const translatedOther = typeof patch.other === 'string' && patch.other !== '' ? patch.other : null;
  const shown = translatedOther ?? source.other;
  if (typeof shown !== 'string') return;
  const kind: FallbackKind = translatedOther === null ? 'missing' : 'plural-form';
  const categories = pluralRules(getBcp47Locale(instrumentation.locale)).resolvedOptions()
    .pluralCategories;
  for (const category of categories) {
    if (category === 'one' || category === 'other') continue;
    if (typeof patch[category] === 'string' && patch[category] !== '') continue;
    result[category] = instrumentation.tagger.tag({
      namespace: instrumentation.namespace,
      path: [...path, category],
      shown,
      kind,
    });
  }
}
