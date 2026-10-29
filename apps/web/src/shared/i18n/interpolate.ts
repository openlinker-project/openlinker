/**
 * interpolate
 *
 * Fills `{name}` placeholders in a copy string. A placeholder with no value
 * is left as written, so a missing param is visible rather than silently
 * blank. Numbers are inserted as given; format them with `useFormat` first
 * when they are shown to an operator.
 *
 * @module shared/i18n
 */
export type InterpolationParams = Readonly<Record<string, string | number>>;

type PlaceholderNames<S extends string> = S extends `${string}{${infer K}}${infer R}`
  ? K | PlaceholderNames<R>
  : never;

/**
 * For a literal template the params are tied to its placeholders, so a typo
 * such as `{ cout: 3 }` is a compile error. A template that is only known as
 * `string` (a resolved copy value) keeps the loose shape.
 */
export type InterpolationParamsFor<S extends string> = string extends S
  ? InterpolationParams
  : Readonly<Record<PlaceholderNames<S>, string | number>>;

const PLACEHOLDER = /\{(\w+)\}/g;

export function interpolate<S extends string>(
  template: S,
  params: InterpolationParamsFor<S>,
): string {
  return template.replace(PLACEHOLDER, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name)
      ? String((params as InterpolationParams)[name])
      : match,
  );
}
