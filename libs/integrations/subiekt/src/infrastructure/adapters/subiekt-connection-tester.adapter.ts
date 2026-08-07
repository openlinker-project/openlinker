/**
 * Subiekt Connection Tester Adapter (#753)
 *
 * Implements `ConnectionTesterPort`. Reads `bridgeBaseUrl`, builds the HTTP
 * client INSIDE a catch-all (so a construction `SubiektConfigException` becomes
 * a failed `ConnectionTestResult`, never a throw), and does a cheap
 * `GET /health` probe.
 *
 * Credentials guard: resolve the bridge token ONLY when
 * `connection.credentialsRef` is truthy; otherwise probe with no token. Never
 * call `credentialsResolver.get('')`. NEVER throws — all failures become a
 * structured `ConnectionTestResult { success:false }`. The token is never logged
 * or echoed.
 *
 * @module libs/integrations/subiekt/src/infrastructure/adapters
 * @implements {ConnectionTesterPort}
 */
import type {
  ConnectionTesterPort,
  ConnectionTestResult,
  CredentialsResolverPort,
} from '@openlinker/core/integrations';
import type { Connection, ConnectionRateLimit } from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';
import type { HttpTransportFactoryPort } from '@openlinker/shared/http';
import { SubiektBridgeHttpClient } from '../http/subiekt-bridge-http.client';
import type { SubiektConnectionConfig } from '../../domain/types/subiekt-connection-config.types';
import type { SubiektBridgeCredentials } from '../../domain/types/subiekt-credentials.types';

export class SubiektConnectionTesterAdapter implements ConnectionTesterPort {
  private readonly logger = new Logger(SubiektConnectionTesterAdapter.name);

  // The manifest's `defaultRateLimit` (#1810) — passed in by the plugin at
  // registration, never re-imported from `subiekt-plugin.ts` here (that
  // module already value-imports this class, and importing it back would
  // reintroduce the cycle PrestaShop's identical constructor shape avoids).
  constructor(
    private readonly http: HttpTransportFactoryPort,
    private readonly defaultRateLimit?: ConnectionRateLimit,
  ) {}

  async test(
    connection: Connection,
    credentialsResolver: CredentialsResolverPort,
  ): Promise<ConnectionTestResult> {
    const startedAt = Date.now();
    try {
      const config = (connection.config ?? {}) as Partial<SubiektConnectionConfig>;
      if (typeof config.bridgeBaseUrl !== 'string' || config.bridgeBaseUrl.length === 0) {
        return {
          success: false,
          message: 'Connection config is missing bridgeBaseUrl',
          latencyMs: Date.now() - startedAt,
        };
      }

      // The bridge token is OPTIONAL — resolve only when credentialsRef is
      // truthy. Never call credentialsResolver.get('').
      let token: string | undefined;
      if (connection.credentialsRef) {
        const credentials = await credentialsResolver.get<SubiektBridgeCredentials>(
          connection.credentialsRef,
        );
        token = credentials.bridgeToken;
      }

      // Connection-bound outbound transport (#1810) — a "Test connection"
      // click is operator-triggered and can be repeated in quick succession;
      // it must go through the same rate limiter as every other Subiekt call
      // site, not a bare globalThis.fetch.
      const fetchImpl = this.http.forConnection(connection, this.defaultRateLimit);

      // Construction may throw SubiektConfigException for a bad / IMDS URL —
      // caught below and translated to a failed result, never a throw.
      const client = new SubiektBridgeHttpClient(config.bridgeBaseUrl, {
        token,
        timeoutMs: config.timeoutMs,
        fetchImpl,
      });

      // Cheap connectivity probe — GET /health. A 4xx still proves the bridge
      // is reachable; only transport failures bubble up.
      await client.checkHealth();

      return {
        success: true,
        message: 'OK',
        latencyMs: Date.now() - startedAt,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Subiekt connection test failed';
      this.logger.warn('Subiekt connection test failed', {
        connectionId: connection.id,
        // NOTE: `message` never carries the bridge token (config/transport errors only).
        error: message,
      });
      return {
        success: false,
        message,
        latencyMs: Date.now() - startedAt,
      };
    }
  }
}
