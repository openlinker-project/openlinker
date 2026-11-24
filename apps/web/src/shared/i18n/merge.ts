/**
 * Merge over English
 *
 * Lays a translation over the English source of the same shape, key by key.
 * English decides which keys exist; a translation can only replace a value,
 * and an empty or missing string falls back to English, so a partially
 * translated namespace never renders a blank.
 *
 * @module shared/i18n
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function mergeOverEnglish(source: unknown, override: unknown): unknown {
  if (typeof source === 'string') {
    // An empty translated string is a gap, not a translation: never show a blank.
    return typeof override === 'string' && override !== '' ? override : source;
  }
  if (!isRecord(source)) return source;
  const result: Record<string, unknown> = {};
  const patch = isRecord(override) ? override : {};
  for (const key of Object.keys(source)) {
    result[key] = mergeOverEnglish(source[key], patch[key]);
  }
  // Polish-only plural categories (few, many) have no English counterpart.
  for (const key of Object.keys(patch)) {
    if (!(key in result) && typeof patch[key] === 'string') result[key] = patch[key];
  }
  return result;
}
