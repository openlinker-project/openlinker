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
import { ConnectionTesterPort, ConnectionTestResult, CredentialsResolverPort } from '@openlinker/core/integrations';
import { Connection } from '@openlinker/core/identifier-mapping';
import { AllegroHttpClient } from '../http/allegro-http-client';
import { AllegroConnectionTokenState } from '../http/allegro-connection-token-state';
import { AllegroCredentials } from '../../domain/types/allegro-credentials.types';
import { AllegroConnectionConfig } from '../../domain/types/allegro-config.types';

const DEFAULT_API_BASE_URLS: Record<string, string> = {
  sandbox: 'https://api.allegro.pl.allegrosandbox.pl',
  production: 'https://api.allegro.pl',
};

export class AllegroConnectionTesterAdapter implements ConnectionTesterPort {
  async test(
    connection: Connection,
    credentialsResolver: CredentialsResolverPort,
  ): Promise<ConnectionTestResult> {
    const startedAt = Date.now();
    try {
      const config = (connection.config ?? {}) as Partial<AllegroConnectionConfig>;
      const environment = config.environment ?? 'sandbox';
      const apiBaseUrl =
        config.apiBaseUrl ?? DEFAULT_API_BASE_URLS[environment] ?? DEFAULT_API_BASE_URLS.sandbox;

      const credentials = await credentialsResolver.get<AllegroCredentials>(
        connection.credentialsRef,
      );

      // Probe deliberately runs without a token-refresh callback: a stale or
      // invalid token must surface as a clear failure (caller can prompt the
      // operator to reconnect), not silently rotate behind the operator's back.
      const tokenState = new AllegroConnectionTokenState(connection.id, credentials);
      const client = new AllegroHttpClient(connection.id, apiBaseUrl, tokenState, {
        maxRetries: 0,
        initialDelayMs: 0,
        maxDelayMs: 0,
        backoffMultiplier: 1,
      });

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
