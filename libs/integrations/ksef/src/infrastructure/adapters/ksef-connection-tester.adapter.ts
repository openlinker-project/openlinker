/**
 * KSeF Connection Tester
 *
 * Probes a live KSeF connection by running the real `ksef-token` auth
 * handshake (`challenge → submit-token → poll → redeem`) so OL Admin can show
 * the connection Active (or a clear failure) right after the operator saves
 * their test token. There is no lighter-weight KSeF endpoint that validates a
 * token's authenticity — the handshake IS the cheapest proof a `ksef-token`
 * credential actually authenticates, mirroring `InfaktConnectionTesterAdapter`'s
 * "one cheap authenticated call" posture as closely as this API model allows.
 *
 * Resolves credentials directly and builds a bare `KsefHttpClient` bundle via
 * `createKsefHttpClient` (mirrors `KsefAdapterFactory.createAdapters`'s
 * env/credentials/seller-NIP resolution, but skips the invoicing-specific
 * wiring this probe doesn't need). Registered against
 * `ConnectionTesterRegistryService` at `ksef.publicapi.v2`.
 *
 * `qualified-seal` connections are not constructable until C4 (per
 * `KsefAdapterFactory.resolveAuthMaterial`) — this returns a clear
 * not-yet-supported result rather than attempting a handshake that can't
 * succeed.
 *
 * SECURITY: never logs the token, challenge, or any redeemed JWT — same
 * posture as `KsefAuthHandshakeService` itself.
 *
 * @module libs/integrations/ksef/src/infrastructure/adapters
 * @see {@link ConnectionTesterPort}
 */
import type {
  ConnectionTesterPort,
  ConnectionTestResult,
  CredentialsResolverPort,
} from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';
import { createKsefHttpClient } from '../http/ksef-http-client.factory';
import { KsefApiException } from '../../domain/exceptions/ksef-api.exception';
import { KsefAuthenticationException } from '../../domain/exceptions/ksef-authentication.exception';
import { KsefConfigException } from '../../domain/exceptions/ksef-config.exception';
import { KsefEnvironmentValues } from '../../domain/types/ksef-connection.types';
import type { KsefConnectionConfig, KsefCredentials } from '../../domain/types/ksef-connection.types';

export class KsefConnectionTesterAdapter implements ConnectionTesterPort {
  private readonly logger = new Logger(KsefConnectionTesterAdapter.name);

  async test(
    connection: Connection,
    credentialsResolver: CredentialsResolverPort,
  ): Promise<ConnectionTestResult> {
    const startedAt = Date.now();
    try {
      const config = connection.config as Partial<KsefConnectionConfig> | undefined;
      const env = config?.env;
      if (!env || !KsefEnvironmentValues.includes(env)) {
        return {
          success: false,
          message: 'KSeF connection has no valid environment',
          latencyMs: Date.now() - startedAt,
        };
      }

      if (!connection.credentialsRef) {
        return {
          success: false,
          message: 'Connection has no stored credentials',
          latencyMs: Date.now() - startedAt,
        };
      }
      const credentials = await credentialsResolver.get<KsefCredentials>(connection.credentialsRef);
      if (!credentials?.authType || !credentials?.secret) {
        return {
          success: false,
          message: 'KSeF credentials missing authType or secret',
          latencyMs: Date.now() - startedAt,
        };
      }
      if (credentials.authType !== 'ksef-token') {
        return {
          success: false,
          message: `Connection testing for authType '${credentials.authType}' is not yet supported (qualified-seal deferred)`,
          latencyMs: Date.now() - startedAt,
        };
      }

      const contextNip = config?.seller?.nip?.trim();
      if (!contextNip) {
        return {
          success: false,
          message: 'KSeF connection has no seller NIP configured',
          latencyMs: Date.now() - startedAt,
        };
      }

      const authMaterial = { authType: 'ksef-token' as const, token: credentials.secret, contextNip };
      const { handshake } = createKsefHttpClient({ connectionId: connection.id, env, authMaterial });
      await handshake.authenticate(authMaterial);

      return {
        success: true,
        message: 'KSeF token authenticated successfully',
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      return this.toFailure(error, Date.now() - startedAt);
    }
  }

  private toFailure(error: unknown, latencyMs: number): ConnectionTestResult {
    if (
      error instanceof KsefAuthenticationException ||
      error instanceof KsefApiException ||
      error instanceof KsefConfigException
    ) {
      const status =
        error instanceof KsefAuthenticationException || error instanceof KsefApiException
          ? error.statusCode
          : undefined;
      return { success: false, status, message: error.message, latencyMs };
    }
    this.logger.debug(`KSeF connection test failed with an unrecognised error: ${String(error)}`);
    return { success: false, message: 'KSeF connection test failed', latencyMs };
  }
}
