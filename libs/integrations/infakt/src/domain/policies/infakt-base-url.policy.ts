/**
 * Infakt Base URL Policy
 *
 * Resolves an Infakt connection's API base URL from its non-secret config
 * (#2174), and guards the legacy `baseUrl` override against cleartext
 * transport (#2179 review round 3, Important #1). A pure, side-effect-free
 * module with no I/O - moved to `domain/` (out of `application/`) per #2179
 * review: it has two call sites - `InfaktAdapterFactory` (application) and
 * `InfaktConnectionTesterAdapter` (infrastructure) - that must agree on the
 * same precedence, and an infrastructure file depending on an `application/`
 * helper violates the documented `infrastructure → domain` layer direction
 * (never `infrastructure → application`). Unlike Erli's `resolveBaseUrl` (a
 * single call site, so it stays inlined as a private factory method there),
 * Infakt's shared logic is a plain domain policy both layers depend downward
 * on.
 *
 * Precedence:
 *   1. Explicit `config.baseUrl` - a legacy override, honoured for backward
 *      compatibility with connections created before the environment select
 *      existed. Trimmed, required to be https (see
 *      {@link isAllowedInfaktBaseUrl}), and - only when it carries no path of
 *      its own - normalized to carry the `/api/v3` suffix (#2176) - a bare-host
 *      override (e.g. the README's own historical example,
 *      `https://api.infakt.pl`) would otherwise build a URL that 404s /
 *      redirects to a garbage host, with Node's `fetch` throwing a raw
 *      transport `TypeError` rather than an `InfaktApiError`. Idempotent: an
 *      override that already ends in `/api/v3` is left alone. An override that
 *      carries a *different* path is left alone too - see
 *      {@link normalizeInfaktBaseUrl} for why: it is read as an operator-run
 *      proxy, not a broken README-example shape, and must be honoured
 *      verbatim.
 *   2. `config.environment === 'sandbox'` - the neutral choice both FE forms
 *      persist today.
 *   3. `INFAKT_DEFAULT_BASE_URL` (production) - the default when neither is
 *      set, matching the pre-#2174 behaviour for existing connections.
 *
 * @module libs/integrations/infakt/src/domain/policies
 */
import { InfaktConfigException } from '../exceptions/infakt-config.exception';
import type { InfaktConnectionConfig } from '../types/infakt-connection.types';

export const INFAKT_DEFAULT_BASE_URL = 'https://api.infakt.pl/api/v3';

/**
 * Sandbox counterpart of {@link INFAKT_DEFAULT_BASE_URL} (#2174). inFakt's
 * sandbox is a separate domain, not a subdomain of `infakt.pl` - verified
 * against inFakt's own developer docs and this package's live-captured
 * fixtures (`__fixtures__/README.md`, `__fixtures__/*.json`), which already
 * carry real `api.sandbox-infakt.pl` pagination links.
 */
export const INFAKT_SANDBOX_BASE_URL = 'https://api.sandbox-infakt.pl/api/v3';

/**
 * True when `value` is a syntactically valid **https** URL (#2179 review round
 * 3, Important #1). `InfaktHttpClient` attaches the `X-inFakt-ApiKey` header to
 * every request against whatever this policy resolves, so a `http://` override
 * would put the API key on the wire in cleartext.
 *
 * Deliberately https-only rather than an `infakt.pl` host allowlist (Erli's
 * `isAllowedErliBaseUrl` does both): the legacy `baseUrl` was documented as a
 * sandbox-testing override and may legitimately point at an operator-run proxy,
 * so an allowlist would break existing rows on their next save. Requiring https
 * is the property that actually protects the credential.
 */
export function isAllowedInfaktBaseUrl(value: string): boolean {
  const url = tryParseInfaktBaseUrl(value);
  return url !== null && url.protocol === 'https:';
}

/**
 * Shared parse step behind {@link isAllowedInfaktBaseUrl} and
 * {@link resolveInfaktBaseUrl}. `resolveInfaktBaseUrl` parses the override
 * exactly once and threads the result into {@link normalizeInfaktBaseUrl}
 * rather than calling `isAllowedInfaktBaseUrl` and re-parsing inside
 * `normalizeInfaktBaseUrl` (#2179/#2994 review, Minor) - harmless either way
 * since a malformed override is rejected before either call, but a second
 * `new URL()` on the same string is pure waste.
 */
function tryParseInfaktBaseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

const INFAKT_API_VERSION_PATH = '/api/v3';

/**
 * Normalizes a legacy `config.baseUrl` override so a bare-host override (the
 * README's own historical example, `https://api.infakt.pl`) always carries the
 * `/api/v3` suffix (#2176 review, Important #1).
 *
 * Only a **root-path** override (no path, or bare `/`) is rewritten. An
 * override that already carries its own path is left completely untouched -
 * including one whose path does not end in `/api/v3` - because
 * {@link isAllowedInfaktBaseUrl}'s own docblock declines a host allowlist on
 * the grounds that this override "may legitimately point at an operator-run
 * proxy": a proxy mounting the v3 surface under its own prefix (e.g.
 * `https://proxy.example.com/infakt`) is exactly such a case, and rewriting it
 * would silently 404 a working connection at read time with no save event and
 * no log line. Parsing via `URL` (rather than an `endsWith` string test) also
 * sidesteps two misreads a string test falls for: a query string appended
 * after `/api/v3` (`https://host/api/v3?probe=1`, previously seen as
 * "not yet suffixed" and given a second suffix) and a path that merely
 * contains the substring in a different segment (`https://host/not-api/v3`,
 * previously seen as "already suffixed" and left broken).
 */
function normalizeInfaktBaseUrl(value: string, parsed: URL): string {
  const withoutTrailingSlash = value.replace(/\/+$/, '');
  if (parsed.pathname !== '' && parsed.pathname !== '/') {
    return withoutTrailingSlash;
  }
  return `${withoutTrailingSlash}${INFAKT_API_VERSION_PATH}`;
}

/**
 * Resolve the base URL for one connection. `connectionId` is optional so pure
 * precedence tests stay terse; both production call sites pass it so the
 * thrown exception names the offending connection.
 *
 * @throws {InfaktConfigException} when the legacy `baseUrl` override is not https.
 */
export function resolveInfaktBaseUrl(
  config: InfaktConnectionConfig,
  connectionId?: string,
): string {
  const override = config.baseUrl?.trim();
  if (override) {
    // Defense-in-depth (mirrors Erli's `resolveBaseUrl`): the config-shape
    // validator enforces https at create/update, but a pre-existing or
    // externally-written row could carry a plain-http override - which would
    // send the API key over cleartext to an arbitrary host. Re-check here so
    // the property does not rest solely on create-time validation.
    //
    // Parsed once and threaded into `normalizeInfaktBaseUrl` rather than
    // calling `isAllowedInfaktBaseUrl` (which parses internally) and letting
    // `normalizeInfaktBaseUrl` parse a second time.
    const parsed = tryParseInfaktBaseUrl(override);
    if (parsed === null || parsed.protocol !== 'https:') {
      throw new InfaktConfigException(
        `Infakt connection ${connectionId ?? '(unknown)'} has a disallowed baseUrl override (must use https)`,
        connectionId,
      );
    }
    // #2176: normalize so an override supplied without `/api/v3` (the
    // README's own historical example) still builds a working URL.
    return normalizeInfaktBaseUrl(override, parsed);
  }
  return config.environment === 'sandbox' ? INFAKT_SANDBOX_BASE_URL : INFAKT_DEFAULT_BASE_URL;
}

/**
 * One-line, credential-free description of what a connection resolved to, for
 * the log lines at the two construction seams (#2179 review round 3,
 * Suggestion #2). Reports how the target was chosen - `legacy-baseUrl` /
 * `sandbox` / `production` - plus the host, because sandbox vs production is
 * the difference between a test document and a legally issued invoice. Only the
 * host is emitted (never the full URL with any query string, and never the API
 * key).
 */
export function describeInfaktTarget(config: InfaktConnectionConfig, resolvedBaseUrl: string): string {
  const source = config.baseUrl?.trim()
    ? 'legacy-baseUrl'
    : config.environment === 'sandbox'
      ? 'sandbox'
      : 'production';
  let host: string;
  try {
    host = new URL(resolvedBaseUrl).host;
  } catch {
    host = '(unparseable)';
  }
  return `${source} (${host})`;
}
