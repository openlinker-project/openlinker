/**
 * DPD Polska Connection Tester Adapter
 *
 * Implements ConnectionTesterPort for DPD connections. DPDServices exposes no
 * cheap `GET /me`-style endpoint — every route is a `POST`. The probe therefore
 * sends an intentionally-empty body to `generatePackagesNumbers`: DPD validates
 * the request BEFORE creating anything, so a valid-credentials call is rejected
 * at validation (HTTP 400, `generationPolicy must not be null`) without minting
 * a waybill or a COD charge, while invalid credentials fail earlier with 401.
 * The 400-vs-401 split is the auth signal.
 *
 * A raw `fetch` is used rather than `DpdHttpClient` on purpose: the client maps
 * a 400 to `ShippingProviderRejectionException` (which here means "auth OK"), so
 * reusing it would invert the success semantics.
 *
 * Never throws — all failures are translated into a structured, UI-safe
 * `ConnectionTestResult` with `success: false`.
 *
 * @module libs/integrations/dpd-polska/src/infrastructure/adapters
 * @implements {ConnectionTesterPort}
 */
import type {
  ConnectionTesterPort,
  ConnectionTestResult,
  CredentialsResolverPort,
} from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { DpdConnectionConfig } from '../../domain/types/dpd-config.types';
import { DpdEnvironmentValues } from '../../domain/types/dpd-config.types';
import type { DpdCredentials } from '../../domain/types/dpd-credentials.types';
import { getDpdServicesBaseUrl } from '../http/dpd-hosts';

const PROBE_PATH = '/public/shipment/v1/generatePackagesNumbers';
const PROBE_TIMEOUT_MS = 10_000;

export class DpdConnectionTesterAdapter implements ConnectionTesterPort {
  async test(
    connection: Connection,
    credentialsResolver: CredentialsResolverPort,
  ): Promise<ConnectionTestResult> {
    const startedAt = Date.now();
    try {
      const config = (connection.config ?? {}) as Partial<DpdConnectionConfig>;
      const environment = config.environment;
      if (
        typeof environment !== 'string' ||
        !DpdEnvironmentValues.includes(environment)
      ) {
        return this.fail('Connection is missing a valid DPD environment', startedAt);
      }

      if (!connection.credentialsRef) {
        return this.fail('Connection has no stored credentials', startedAt);
      }
      const credentials = await credentialsResolver.get<DpdCredentials>(connection.credentialsRef);
      if (!credentials?.login || !credentials?.password) {
        return this.fail('Stored credentials are missing login/password', startedAt);
      }

      const status = await this.probe(environment, credentials, config.masterFid);
      return this.interpret(status, startedAt);
    } catch (error) {
      return this.fail((error as Error).message ?? 'DPD probe failed', startedAt);
    }
  }

  /** Issue the empty-body probe and return the HTTP status code. */
  private async probe(
    environment: DpdConnectionConfig['environment'],
    credentials: DpdCredentials,
    masterFid: string | undefined,
  ): Promise<number> {
    const url = new URL(PROBE_PATH, getDpdServicesBaseUrl(environment)).toString();
    const token = Buffer.from(`${credentials.login}:${credentials.password}`, 'utf8').toString(
      'base64',
    );
    const headers: Record<string, string> = {
      Authorization: `Basic ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (masterFid) {
      headers['X-DPD-FID'] = masterFid;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: '{}',
        signal: controller.signal,
      });
      return response.status;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * A 400 means auth was accepted and only the (deliberately empty) body was
   * rejected — the connection is live. 401/403 are credential failures.
   */
  private interpret(status: number, startedAt: number): ConnectionTestResult {
    if (status === 400) {
      return { success: true, status, message: 'OK', latencyMs: Date.now() - startedAt };
    }
    if (status === 401) {
      return this.fail('401 Unauthorized — check DPD login/password and payer FID', startedAt, status);
    }
    if (status === 403) {
      return this.fail('403 Forbidden — credentials lack access', startedAt, status);
    }
    return this.fail(`Unexpected DPD probe status ${status}`, startedAt, status);
  }

  private fail(message: string, startedAt: number, status?: number): ConnectionTestResult {
    return { success: false, status, message, latencyMs: Date.now() - startedAt };
  }
}
