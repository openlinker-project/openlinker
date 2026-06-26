/**
 * KSeF Host Resolution
 *
 * Maps a `KsefEnvironment` to its Public API v2 base URL. Centralised so the
 * client + factory never hand-build the host string. The `/v2` API-version
 * segment is part of the base path (the adapterKey pins the same major version).
 *
 * Hosts are the authoritative KSeF API 2.0 bases (per the MF `srodowiska.md`
 * environments table + the OpenAPI `servers` block): the API lives on the
 * `api[-env].ksef.mf.gov.pl` host with a bare `/v2` base path — NOT on
 * `ksef[-env].mf.gov.pl/api/v2`.
 *
 * @module libs/integrations/ksef/src/infrastructure/http
 */
import type { KsefEnvironment } from '../../domain/types/ksef-connection.types';
import { KsefConfigException } from '../../domain/exceptions/ksef-config.exception';

const KSEF_BASE_URLS: Record<KsefEnvironment, string> = {
  test: 'https://api-test.ksef.mf.gov.pl/v2',
  demo: 'https://api-demo.ksef.mf.gov.pl/v2',
  prod: 'https://api.ksef.mf.gov.pl/v2',
};

/**
 * Resolve the KSeF base URL for an environment.
 *
 * @throws KsefConfigException for an unrecognised environment (a config error
 *   on a pre-existing connection row, surfaced before any request leaves).
 */
export function resolveKsefBaseUrl(env: KsefEnvironment): string {
  const baseUrl = KSEF_BASE_URLS[env];
  if (!baseUrl) {
    throw new KsefConfigException(`Unrecognised KSeF environment: ${String(env)}`);
  }
  return baseUrl;
}
