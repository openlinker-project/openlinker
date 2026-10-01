/**
 * Shoper Connection Tester Adapter
 *
 * Implements `ConnectionTesterPort` for Shoper. Probes
 * `GET /webapi/rest/application-config` with the stored Bearer token
 * (SPIKE-3638: cheap, always available, needs no area-specific scope), so a
 * pass means "the host is a Shoper shop and the token is valid".
 *
 * It does NOT prove the token holds every scope the capabilities will need -
 * Shoper enforces those per resource (`403 insufficient_scope`), and each
 * capability epic reports its own missing area. The failure message for a 403
 * lists the required areas so the operator can fix it in one visit.
 *
 * Never throws: every failure becomes a `ConnectionTestResult` with
 * `success: false`. Unexpected failures are logged at warn level. The token is
 * never logged or returned.
 *
 * Single attempt - a retry would mask real latency and make auth failures
 * harder to diagnose.
 *
 * @module libs/integrations/shoper/src/infrastructure/adapters
 * @implements {ConnectionTesterPort}
 */
import type {
  ConnectionTesterPort,
  ConnectionTestResult,
  CredentialsResolverPort,
} from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';
import type { HttpTransportFactoryPort } from '@openlinker/shared/http';

import { SHOPER_CONNECTION_TEST_PATH, SHOPER_REQUIRED_SCOPES } from '../../shoper.constants';
import { ShoperApiError } from '../../domain/exceptions/shoper-api.error';
import { ShoperNetworkError } from '../../domain/exceptions/shoper-network.error';
import { parseShoperBaseUrl } from '../../domain/policies/shoper-base-url.policy';
import type { ShoperCredentials } from '../../domain/types/shoper-credentials.types';
import { ShoperHttpClient } from '../http/shoper-http-client';

export class ShoperConnectionTesterAdapter implements ConnectionTesterPort {
  private readonly logger = new Logger(ShoperConnectionTesterAdapter.name);

  constructor(private readonly http: HttpTransportFactoryPort) {}

  async test(
    connection: Connection,
    credentialsResolver: CredentialsResolverPort,
  ): Promise<ConnectionTestResult> {
    const startedAt = Date.now();
    const elapsed = (): number => Date.now() - startedAt;

    try {
      const base = parseShoperBaseUrl((connection.config ?? {}).baseUrl);
      if (!base.ok) {
        return {
          success: false,
          message: `Invalid connection config: ${base.issues.join('; ')}`,
          latencyMs: elapsed(),
        };
      }

      if (!connection.credentialsRef) {
        return {
          success: false,
          message: 'Connection has no stored credentials',
          latencyMs: elapsed(),
        };
      }

      const credentials = await credentialsResolver.get<ShoperCredentials>(
        connection.credentialsRef,
      );
      if (typeof credentials.token !== 'string' || credentials.token.trim().length === 0) {
        return {
          success: false,
          message: 'Stored credentials have no API token',
          latencyMs: elapsed(),
        };
      }

      // Connection-bound outbound transport (#1810): "Test connection" is
      // operator-triggered and repeatable, so it goes through the same rate
      // limiter as every other call site, not a bare fetch.
      const client = new ShoperHttpClient(
        { host: base.host, token: credentials.token },
        this.http.forConnection(connection),
      );
      const response = await client.get(SHOPER_CONNECTION_TEST_PATH);

      return {
        success: true,
        status: response.status,
        message: 'OK',
        latencyMs: elapsed(),
      };
    } catch (error) {
      return this.toFailure(error, connection.id, elapsed());
    }
  }

  private toFailure(error: unknown, connectionId: string, latencyMs: number): ConnectionTestResult {
    if (error instanceof ShoperApiError) {
      const { statusCode } = error;
      if (statusCode === 401) {
        return {
          success: false,
          status: statusCode,
          message: 'Shoper rejected the API token - check that it is correct and has not been revoked',
          latencyMs,
        };
      }
      if (statusCode === 403) {
        return {
          success: false,
          status: statusCode,
          message:
            'The Shoper API token lacks a required permission. Grant these areas to the ' +
            `integration in the shop admin panel: ${SHOPER_REQUIRED_SCOPES.join(', ')}`,
          latencyMs,
        };
      }
      if (statusCode === 404) {
        return {
          success: false,
          status: statusCode,
          message: 'Shoper REST API not found - verify the shop host name',
          latencyMs,
        };
      }
      this.logger.warn('Shoper connection test failed', {
        connectionId,
        status: statusCode,
        error: error.message,
      });
      return {
        success: false,
        status: statusCode,
        message:
          statusCode >= 500
            ? `Shoper returned an unexpected error (HTTP ${statusCode})`
            : `Shoper returned HTTP ${statusCode}`,
        latencyMs,
      };
    }

    if (error instanceof ShoperNetworkError) {
      this.logger.warn('Shoper connection test failed', { connectionId, error: error.message });
      return {
        success: false,
        message: error.timedOut
          ? 'Shoper connection test timed out - the shop did not respond in time'
          : (error.originalError?.message ?? error.message),
        latencyMs,
      };
    }

    const message = error instanceof Error ? error.message : 'Shoper connection test failed';
    this.logger.warn('Shoper connection test failed unexpectedly', { connectionId, error: message });
    return { success: false, message, latencyMs };
  }
}
