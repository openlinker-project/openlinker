/**
 * Retry-After coercion
 *
 * Reads the upstream `Retry-After` header into the number of seconds the
 * exception carries (#2613). Pure - it is the coercion rule for
 * `PrestashopApiException.retryAfterSeconds`, so it lives with that value
 * rather than inside the client, which cannot be unit-tested without a
 * transport.
 *
 * PrestaShop core sends no `Retry-After`; a fronting proxy, CDN or WAF is what
 * produces one. Both RFC 9110 forms are accepted, and anything else returns
 * `undefined` so an unparseable header is treated as absent rather than as a
 * zero-second wait.
 *
 * @module libs/integrations/prestashop/src/infrastructure/http
 */

/** Upper bound on an honoured wait, so a hostile or mistaken header cannot park a job for days. */
const MAX_RETRY_AFTER_SECONDS = 3600;

export function parseRetryAfterSeconds(
  headerValue: string | null | undefined,
  now: Date = new Date()
): number | undefined {
  if (headerValue === null || headerValue === undefined) {
    return undefined;
  }

  const raw = headerValue.trim();
  if (raw === '') {
    return undefined;
  }

  if (/^\d+$/.test(raw)) {
    return clamp(Number(raw));
  }

  const httpDateMs = Date.parse(raw);
  if (Number.isNaN(httpDateMs)) {
    return undefined;
  }

  return clamp(Math.ceil((httpDateMs - now.getTime()) / 1000));
}

function clamp(seconds: number): number | undefined {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return undefined;
  }
  return Math.min(seconds, MAX_RETRY_AFTER_SECONDS);
}
