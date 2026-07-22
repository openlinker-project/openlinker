/**
 * is-safe-http-url
 *
 * Shared guard for adapter-controlled URLs that reach the FE with no
 * server-side scheme validation. React JSX does not sanitize `href`, so any
 * value rendered into an anchor is treated as untrusted: the anchor is emitted
 * only when the scheme is `http:` / `https:`. Any other scheme
 * (`javascript:`, `data:`, `vbscript:`, …), relative / garbage strings, or a
 * whitespace-prefixed payload degrades to no link.
 *
 * @module apps/web/src/shared/lib
 */

/** True only for `http:` / `https:` absolute URLs. `new URL().protocol` is the
 *  stricter form — it rejects relative strings and leading whitespace. */
export function isSafeHttpUrl(value: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
