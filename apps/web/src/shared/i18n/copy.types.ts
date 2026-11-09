/**
 * Copy Types
 *
 * Shapes of the translation namespaces (ADR-081). English is the source
 * shape; Polish mirrors it key for key, with plural entries carrying
 * the Polish one/few/many/other forms. `PolishCopy` is deep-partial on
 * purpose: a missing Polish key shows the English text at runtime, so it is a
 * gap to translate (reported by `check-locales`), never a type error (#3891).
 *
 * Convention: an object whose keys are exactly `one` and `other` is a plural
 * entry, never a nested section. Do not name sections `one` / `other`.
 *
 * @module shared/i18n
 */

export interface EnglishPlural {
  readonly one: string;
  readonly other: string;
}

export interface PolishPlural {
  readonly one: string;
  readonly few: string;
  readonly many: string;
  readonly other: string;
}

/**
 * Plural forms as a component reads them: every language has `one` and
 * `other`; `few` / `many` exist where the language needs them.
 */
export interface PluralForms {
  readonly one: string;
  readonly other: string;
  readonly few?: string;
  readonly many?: string;
}

export interface CopyTree {
  readonly [key: string]: string | EnglishPlural | CopyTree;
}

/**
 * True only for an object whose keys are exactly `one` and `other`, so a
 * section that happens to contain those keys next to others stays a section.
 */
type IsPlural<T> = T extends EnglishPlural
  ? Exclude<keyof T, keyof EnglishPlural> extends never
    ? true
    : false
  : false;

type PolishOf<T> = T extends string
  ? string
  : IsPlural<T> extends true
    ? PolishPlural
    : { readonly [K in keyof T]: PolishOf<T[K]> };

type DeepPartial<T> = T extends string ? T : { readonly [K in keyof T]?: DeepPartial<T[K]> };

/**
 * The Polish half of a copy file. Deep-partial by design (#3891): a missing
 * key falls back to English and `check-locales` warns about it. The shape is
 * still checked - excess keys are rejected, so Polish can never carry a key
 * English lacks, and a string cannot stand where English has a section or the
 * reverse. Being partial, a plural missing `few` / `many` is not a type error
 * either.
 */
export type PolishCopy<T extends CopyTree> = DeepPartial<PolishOf<T>>;

/**
 * A copy file as resolved for one language: every leaf a string, every
 * plural a `PluralForms`.
 */
export type ResolvedCopy<T> = T extends string
  ? string
  : IsPlural<T> extends true
    ? PluralForms
    : { readonly [K in keyof T]: ResolvedCopy<T[K]> };
