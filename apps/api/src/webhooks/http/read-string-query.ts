/**
 * Read String Query
 *
 * Normalizes an Express query object into the `Record<string, string>` the
 * decoder port takes: the FIRST string value of each key, everything else
 * (repeated keys beyond the first, nested objects) dropped. A webhook decoder
 * that authenticates by a URL token must see a plain string, never an array a
 * caller could use to smuggle a second value past a `===` comparison.
 *
 * The result may hold the delivery's credential: it is handed to
 * `decoder.verify` and nowhere else, and is never logged.
 *
 * @module apps/api/src/webhooks/http
 */
export function readStringQuery(query: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (query === undefined || query === null) {
    return out;
  }
  for (const [key, value] of Object.entries(query)) {
    const first: unknown = Array.isArray(value) ? (value as unknown[])[0] : value;
    if (typeof first === 'string') {
      out[key] = first;
    }
  }
  return out;
}
