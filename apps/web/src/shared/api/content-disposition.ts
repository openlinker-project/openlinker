/**
 * Content-Disposition filename reader
 *
 * A blob download cannot read the server's chosen filename from the body, so
 * `requestFile` hands it back separately. Prefers the RFC 5987 `filename*`
 * form when present (it carries non-ASCII names), otherwise the plain
 * `filename="..."` form. Returns `null` for a header with neither, so the
 * caller picks its own fallback name rather than this helper inventing one.
 *
 * @module apps/web/src/shared/api
 */
export function parseContentDispositionFilename(header: string | null): string | null {
  if (!header) {
    return null;
  }
  const extended = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header);
  if (extended?.[1]) {
    try {
      return decodeURIComponent(extended[1].trim());
    } catch {
      // Fall through to the plain form: a malformed escape must not lose the file name.
    }
  }
  const quoted = /filename\s*=\s*"([^"]+)"/.exec(header);
  if (quoted?.[1]) {
    return quoted[1];
  }
  const bare = /filename\s*=\s*([^;]+)/.exec(header);
  return bare?.[1] ? bare[1].trim() : null;
}
