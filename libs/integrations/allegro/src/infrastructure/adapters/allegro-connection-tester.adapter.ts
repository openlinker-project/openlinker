/**
 * Allegro Connection Tester Adapter
 *
 * Implements ConnectionTesterPort for Allegro connections. Performs a cheap
 * authenticated probe against `GET /me` (standard OAuth authorization check)
 * to validate that the stored access token + API base URL still work.
 *
 * Never throws — all failures are translated into a structured
 * `ConnectionTestResult` with `success: false`.
 *
 * @module libs/integrations/allegro/src/infrastructure/adapters
 * @implements {ConnectionTesterPort}
 */
import type {
  ConnectionTesterPort,
  ConnectionTestResult,
  CredentialsResolverPort,
} from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { HttpTransportFactoryPort } from '@openlinker/shared/http';
import { AllegroHttpClient } from '../http/allegro-http-client';
import { AllegroConnectionTokenState } from '../http/allegro-connection-token-state';
import { getAllegroRestApiBaseUrl } from '../http/allegro-hosts';
import type { AllegroCredentials } from '../../domain/types/allegro-credentials.types';
import type { AllegroConnectionConfig } from '../../domain/types/allegro-config.types';

export class AllegroConnectionTesterAdapter implements ConnectionTesterPort {
  constructor(private readonly http: HttpTransportFactoryPort) {}

  async test(
    connection: Connection,
    credentialsResolver: CredentialsResolverPort
  ): Promise<ConnectionTestResult> {
    const startedAt = Date.now();
    try {
      const config = (connection.config ?? {}) as Partial<AllegroConnectionConfig>;
      const environment = config.environment ?? 'sandbox';
      const apiBaseUrl = config.apiBaseUrl ?? getAllegroRestApiBaseUrl(environment);

      const credentials = await credentialsResolver.get<AllegroCredentials>(
        connection.credentialsRef
      );

      // Connection-bound outbound transport (#1810) — a "Test connection"
      // click is operator-triggered and can be repeated in quick succession;
      // it must go through the same rate limiter as every other Allegro call
      // site, not a bare globalThis.fetch.
      const fetchImpl = this.http.for(connection);

      // Probe deliberately runs without a token-refresh callback: a stale or
      // invalid token must surface as a clear failure (caller can prompt the
      // operator to reconnect), not silently rotate behind the operator's back.
      const tokenState = new AllegroConnectionTokenState(connection.id, credentials);
      const client = new AllegroHttpClient(
        connection.id,
        apiBaseUrl,
        tokenState,
        {
          maxRetries: 0,
          initialDelayMs: 0,
          maxDelayMs: 0,
          backoffMultiplier: 1,
        },
        fetchImpl
      );

      const response = await client.get('/me');

      return {
        success: true,
        status: response.status,
        message: 'OK',
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      const err = error as { statusCode?: number; status?: number; message?: string };
      return {
        success: false,
        status:
          typeof err.statusCode === 'number'
            ? err.statusCode
            : typeof err.status === 'number'
              ? err.status
              : undefined,
        message: err.message ?? 'Allegro probe failed',
        latencyMs: Date.now() - startedAt,
      };
    }
  }
}
