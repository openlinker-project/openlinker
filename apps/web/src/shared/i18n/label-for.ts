/**
 * labelFor
 *
 * Reads the label for a raw value the API sent (a status, a kind) from a copy
 * map, and falls back to the raw value (or a given fallback) when the map has no
 * entry. Guarded with
 * an own-property check because a plain `map[value]` returns a function from
 * `Object.prototype` for values such as `constructor` or `toString`, which
 * React would then render or throw on.
 *
 * @module shared/i18n
 */
export function labelFor(
  map: Readonly<Record<string, string>>,
  value: string,
  fallback: string = value,
): string {
  return Object.prototype.hasOwnProperty.call(map, value) ? map[value] : fallback;
}
