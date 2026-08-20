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
 *      existed. Trimmed, and required to be https (see
 *      {@link isAllowedInfaktBaseUrl}).
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
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === 'https:';
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
    if (!isAllowedInfaktBaseUrl(override)) {
      throw new InfaktConfigException(
        `Infakt connection ${connectionId ?? '(unknown)'} has a disallowed baseUrl override (must use https)`,
        connectionId,
      );
    }
    return override;
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
