/**
 * Infakt Base URL Policy
 *
 * Resolves an Infakt connection's API base URL from its non-secret config
 * (#2174). A pure, side-effect-free function with no I/O - moved to `domain/`
 * (out of `application/`) per #2179 review: it has two call sites -
 * `InfaktAdapterFactory` (application) and `InfaktConnectionTesterAdapter`
 * (infrastructure) - that must agree on the same precedence, and an
 * infrastructure file depending on an `application/` helper violates the
 * documented `infrastructure → domain` layer direction (never
 * `infrastructure → application`). Unlike Erli's `resolveBaseUrl` (a single
 * call site, so it stays inlined as a private factory method there), Infakt's
 * shared logic is a plain domain policy both layers depend downward on.
 *
 * Precedence:
 *   1. Explicit `config.baseUrl` - a legacy override, honoured for backward
 *      compatibility with connections created before the environment select
 *      existed.
 *   2. `config.environment === 'sandbox'` - the neutral choice both FE forms
 *      persist today.
 *   3. `INFAKT_DEFAULT_BASE_URL` (production) - the default when neither is
 *      set, matching the pre-#2174 behaviour for existing connections.
 *
 * @module libs/integrations/infakt/src/domain/policies
 */
import type { InfaktConnectionConfig } from '../types/infakt-connection.types';

export const INFAKT_DEFAULT_BASE_URL = 'https://api.infakt.pl/api/v3';

/** Sandbox counterpart of {@link INFAKT_DEFAULT_BASE_URL} (#2174). */
export const INFAKT_SANDBOX_BASE_URL = 'https://api.sandbox.infakt.pl/api/v3';

export function resolveInfaktBaseUrl(config: InfaktConnectionConfig): string {
  if (config.baseUrl) {
    return config.baseUrl;
  }
  return config.environment === 'sandbox' ? INFAKT_SANDBOX_BASE_URL : INFAKT_DEFAULT_BASE_URL;
}
