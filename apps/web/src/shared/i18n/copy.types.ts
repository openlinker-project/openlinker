/**
 * Copy Types
 *
 * Shapes for the typed per-feature copy files (ADR-079). English is the
 * source shape; Polish mirrors it key for key, with plural entries carrying
 * the Polish one/few/many/other forms. `PolishCopy` is deep-partial until the
 * lock-in step (#3891) so features can be extracted in English first.
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

type PolishOf<T> = T extends string
  ? string
  : T extends EnglishPlural
    ? PolishPlural
    : { readonly [K in keyof T]: PolishOf<T[K]> };

type DeepPartial<T> = T extends string ? T : { readonly [K in keyof T]?: DeepPartial<T[K]> };

/**
 * The Polish half of a copy file. Partial until #3891 flips it to
 * `PolishOf<T>`; excess keys are still rejected, so Polish can never carry a
 * key English lacks.
 */
export type PolishCopy<T extends CopyTree> = DeepPartial<PolishOf<T>>;

/**
 * A copy file as resolved for one language: every leaf a string, every
 * plural a `PluralForms`.
 */
export type ResolvedCopy<T> = T extends string
  ? string
  : T extends EnglishPlural
    ? PluralForms
    : { readonly [K in keyof T]: ResolvedCopy<T[K]> };

export interface LocaleCopy<T extends CopyTree> {
  readonly en: T;
  readonly pl: PolishCopy<T>;
}
