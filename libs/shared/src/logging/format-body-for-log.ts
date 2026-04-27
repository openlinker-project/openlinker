/**
 * Format Body For Log
 *
 * Caps the length of an HTTP/adapter response or request body — or any
 * string-typed log payload (e.g. an `Error.message`) — before it is embedded
 * in a log line. The cap is read once at module load from
 * `OL_LOG_BODY_MAX_BYTES`:
 *   - unset / empty / `0` / negative / non-numeric → return body unchanged (default)
 *   - strict positive integer N → if `body.length > N`, return
 *     `${body.slice(0, N)}… [truncated, total length: ${body.length}]`;
 *     otherwise return body unchanged.
 *
 * The cap operates on JS string units (UTF-16 code units), not UTF-8 bytes.
 * For ASCII the two are equivalent; for multi-byte content (e.g. Polish chars
 * in PrestaShop / Allegro responses) the resulting log line may exceed N
 * bytes. The env name is kept per #416 for operator clarity; this caveat
 * lives here so the next debugger sees it.
 *
 * The helper is intentionally log-only — values stored on domain exceptions
 * keep the FULL body (matches #409 / `AllegroApiException`). If you ever do
 * store the helper's output, treat it as opaque text: a truncation marker may
 * be appended and the result is no longer guaranteed to JSON-parse.
 *
 * Read-once at module init matches `AiIntegrationModule.register()`. Restart
 * the process to change the cap.
 *
 * @module libs/shared/src/logging
 */

const MAX_CHARS = parseMaxChars(process.env.OL_LOG_BODY_MAX_BYTES);

function parseMaxChars(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 0;
  // Use Number(), not parseInt() — parseInt('10abc', 10) silently returns 10.
  // We want strict integer parsing: anything else falls back to uncapped.
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return 0;
  return n;
}

export function formatBodyForLog(body: string): string {
  if (MAX_CHARS === 0 || body.length <= MAX_CHARS) return body;
  return `${body.slice(0, MAX_CHARS)}… [truncated, total length: ${body.length}]`;
}
