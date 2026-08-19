/**
 * Infakt Base URL Resolver
 *
 * Resolves an Infakt connection's API base URL from its non-secret config
 * (#2174). Extracted into its own pure function because it has two call
 * sites — `InfaktAdapterFactory` and `InfaktConnectionTesterAdapter` — that
 * must agree on the same precedence, unlike Erli's `resolveBaseUrl` (a single
 * call site, so it stays inlined as a private factory method there).
 *
 * Precedence:
 *   1. Explicit `config.baseUrl` — a legacy override, honoured for backward
 *      compatibility with connections created before the environment select
 *      existed.
 *   2. `config.environment === 'sandbox'` — the neutral choice both FE forms
 *      persist today.
 *   3. `INFAKT_DEFAULT_BASE_URL` (production) — the default when neither is
 *      set, matching the pre-#2174 behaviour for existing connections.
 *
 * @module libs/integrations/infakt/src/application
 */
import { INFAKT_DEFAULT_BASE_URL, INFAKT_SANDBOX_BASE_URL } from '../infrastructure/http/infakt-http-client';
import type { InfaktConnectionConfig } from '../domain/types/infakt-connection.types';

export function resolveInfaktBaseUrl(config: InfaktConnectionConfig): string {
  if (config.baseUrl) {
    return config.baseUrl;
  }
  return config.environment === 'sandbox' ? INFAKT_SANDBOX_BASE_URL : INFAKT_DEFAULT_BASE_URL;
}
