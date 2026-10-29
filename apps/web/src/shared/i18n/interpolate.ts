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

const PLACEHOLDER = /\{(\w+)\}/g;

export function interpolate(template: string, params: InterpolationParams): string {
  return template.replace(PLACEHOLDER, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}
