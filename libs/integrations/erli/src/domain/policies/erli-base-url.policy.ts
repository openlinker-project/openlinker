/**
 * Erli base-URL policy
 *
 * SSRF guard for the operator-set `connection.config.baseUrl` override. The base
 * URL becomes a server-side authenticated GET carrying the static API key, so an
 * arbitrary host would let a misconfigured/compromised connection exfiltrate the
 * bearer key. The override must therefore be https AND target an Erli-owned host.
 *
 * The confirmed host set (prod `erli.pl`, sandbox `sandbox.erli.dev`, both #992)
 * lives here as the single source of truth shared by the create/update validator
 * and the per-connection factory (defense-in-depth). A `null` connection.config
 * (no override) is unaffected — the default prod base URL is used.
 *
 * @module libs/integrations/erli/src/domain/policies
 */

/** Apex Erli hosts; a base-URL host must equal one of these or be a subdomain of it. */
export const ERLI_ALLOWED_BASE_URL_HOSTS = ['erli.pl', 'erli.dev'] as const;

/**
 * True when `host` is an Erli-owned host — exactly an apex host or a subdomain of
 * one. The leading-dot suffix check prevents look-alikes (`noterli.pl`,
 * `erli.pl.evil.com`) from slipping through.
 */
export function isAllowedErliHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return ERLI_ALLOWED_BASE_URL_HOSTS.some(
    (allowed) => normalized === allowed || normalized.endsWith(`.${allowed}`),
  );
}

/**
 * True when `value` is a syntactically valid, https, Erli-owned base URL. The
 * single guard both the config-shape validator and the adapter factory call so
 * the SSRF/cleartext property can't drift between the create-time gate and the
 * per-connection construction seam.
 */
export function isAllowedErliBaseUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && isAllowedErliHost(url.hostname);
}
