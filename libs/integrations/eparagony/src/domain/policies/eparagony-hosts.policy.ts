/**
 * eparagony.pl Host Policy
 *
 * Resolves the two base URLs a connection talks to. They are two DIFFERENT
 * hosts: OAuth lives on `login[.sandbox].eparagony.pl` while the documents API
 * lives on `api.eparagony.pl` / `sandbox.eparagony.pl`. Pointing the token
 * request at the API host is the first mistake an integrator makes, so the
 * mapping is a named policy rather than an inline string.
 *
 * Pure - no I/O, no framework. Mirrors `erli-base-url.policy.ts`.
 *
 * @module libs/integrations/eparagony/src/domain/policies
 */
import { EparagonyConfigException } from '../exceptions/eparagony-config.exception';
import type { EparagonyConnectionConfig, EparagonyEnvironment } from '../types/eparagony-config.types';

const HOSTS: Record<EparagonyEnvironment, { api: string; auth: string }> = {
  sandbox: {
    api: 'https://sandbox.eparagony.pl',
    auth: 'https://login.sandbox.eparagony.pl',
  },
  production: {
    api: 'https://api.eparagony.pl',
    auth: 'https://login.eparagony.pl',
  },
};

export interface EparagonyHosts {
  apiBaseUrl: string;
  authBaseUrl: string;
}

/**
 * Resolve both hosts for a connection. An explicit override wins over the
 * environment default but must still be https - the client credentials and the
 * bearer token ride these URLs.
 */
export function resolveEparagonyHosts(
  config: EparagonyConnectionConfig,
  connectionId?: string,
): EparagonyHosts {
  const defaults = HOSTS[config.environment] ?? HOSTS.production;
  return {
    apiBaseUrl: normalizeHost(config.apiBaseUrl ?? defaults.api, 'apiBaseUrl', connectionId),
    authBaseUrl: normalizeHost(config.authBaseUrl ?? defaults.auth, 'authBaseUrl', connectionId),
  };
}

function normalizeHost(value: string, field: string, connectionId?: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new EparagonyConfigException(
      `eparagony.pl connection has an invalid ${field}: "${value}"`,
      `The e-receipt connection's ${field} is not a valid URL.`,
      connectionId,
    );
  }
  if (parsed.protocol !== 'https:') {
    throw new EparagonyConfigException(
      `eparagony.pl connection ${field} must be https, got "${parsed.protocol}"`,
      `The e-receipt connection's ${field} must use https.`,
      connectionId,
    );
  }
  return value.replace(/\/+$/, '');
}
