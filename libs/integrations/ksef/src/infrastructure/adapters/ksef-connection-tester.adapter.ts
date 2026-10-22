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
import type { HttpTransportFactoryPort } from '@openlinker/shared/http';
import { createKsefHttpClient } from '../http/ksef-http-client.factory';
import type { IKsefHttpClient } from '../http/ksef-http-client.interface';
import { normalizePlNip } from './nip-checksum';
import { KsefApiException } from '../../domain/exceptions/ksef-api.exception';
import { KsefPermissionDeniedException } from '../../domain/exceptions/ksef-permission-denied.exception';
import { KsefAuthenticationException } from '../../domain/exceptions/ksef-authentication.exception';
import { KsefConfigException } from '../../domain/exceptions/ksef-config.exception';
import { KsefSessionCryptoException } from '../../domain/exceptions/ksef-session-crypto.exception';
import { KsefEnvironmentValues } from '../../domain/types/ksef-connection.types';
import type { KsefConnectionConfig, KsefCredentials } from '../../domain/types/ksef-connection.types';

export class KsefConnectionTesterAdapter implements ConnectionTesterPort {
  private readonly logger = new Logger(KsefConnectionTesterAdapter.name);

  constructor(private readonly http: HttpTransportFactoryPort) {}

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

      const contextNip = typeof config?.seller?.nip === 'string' ? normalizePlNip(config.seller.nip) : '';
      if (!contextNip) {
        return {
          success: false,
          message: 'KSeF connection has no seller NIP configured',
          latencyMs: Date.now() - startedAt,
        };
      }

      const authMaterial = { authType: 'ksef-token' as const, token: credentials.secret, contextNip };
      // Connection-bound outbound transport (#1810) — a "Test connection"
      // click is operator-triggered and can be repeated in quick succession;
      // it must go through the same rate limiter as every other KSeF call
      // site, not a bare globalThis.fetch. No manifest `defaultRateLimit`
      // argument: KSeF ships none (see `ksefAdapterManifest`), and reading it
      // here would import the plugin module the plugin already imports this
      // adapter from — a cycle PrestaShop avoids by injecting the value.
      const fetchImpl = this.http.forConnection(connection);
      const { handshake, httpClient } = createKsefHttpClient({
        connectionId: connection.id,
        env,
        authMaterial,
        fetchImpl,
      });
      await handshake.authenticate(authMaterial);
      const issuance = await this.probeIssuancePermission(httpClient, contextNip);

      return {
        success: true,
        message: ISSUANCE_PROBE_MESSAGES[issuance],
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      return this.toFailure(error, Date.now() - startedAt);
    }
  }

  /**
   * DEF-17: a token without the issuance grant authenticates perfectly well, so
   * the handshake alone told an operator "OK" and the first invoice then failed.
   * KSeF 2.0 lists the session's own grants at
   * `POST /permissions/query/personal/grants`; this asks for `InvoiceWrite`.
   *
   * The answer is a SUGGESTION, never a refusal: a test reports what KSeF said,
   * and an inconclusive read (the query itself refused, an unexpected shape)
   * says so instead of failing a token that may be fine. Not one of the three
   * rate-limited session writes, so the check spends no issuance budget.
   */
  private async probeIssuancePermission(
    httpClient: IKsefHttpClient,
    contextNip: string,
  ): Promise<IssuanceProbe> {
    try {
      const response = await httpClient.post<PersonalGrantsResponse>(
        '/permissions/query/personal/grants',
        {
          contextIdentifier: { type: 'Nip', value: contextNip },
          permissionTypes: ['InvoiceWrite'],
          permissionState: 'Active',
        },
        { idempotent: true, queryParams: { pageSize: 10 } },
      );
      const data = response.data;
      if (!data || !Array.isArray(data.permissions)) {
        return 'unknown';
      }
      const granted =
        data.permissions.some((p) => p?.permissionScope === 'InvoiceWrite') ||
        (Array.isArray(data.ownerPermissions) && data.ownerPermissions.includes('InvoiceWrite'));
      return granted ? 'granted' : 'missing';
    } catch (error) {
      this.logger.debug(
        `KSeF permission probe inconclusive: ${error instanceof Error ? error.name : String(error)}`,
      );
      return 'unknown';
    }
  }

  private toFailure(error: unknown, latencyMs: number): ConnectionTestResult {
    if (error instanceof KsefPermissionDeniedException) {
      // Authenticated, but the token is not authorized for the action. KSeF has
      // no token-scope introspection endpoint, so this runtime 403 is the earliest
      // machine-detectable least-privilege signal - surface it distinctly with an
      // operator-actionable hint rather than a generic auth failure.
      return {
        success: false,
        status: 403,
        message:
          'KSeF token authenticated but is not authorized - ensure the token was ' +
          'generated with the "wystawianie faktur" (invoice issuance) permission',
        latencyMs,
      };
    }
    if (
      error instanceof KsefAuthenticationException ||
      error instanceof KsefApiException ||
      error instanceof KsefConfigException ||
      error instanceof KsefSessionCryptoException
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

type IssuanceProbe = 'granted' | 'missing' | 'unknown';

/** Subset of KSeF's `QueryPersonalPermissionsResponse` the probe reads. */
interface PersonalGrantsResponse {
  permissions?: { permissionScope?: string }[];
  ownerPermissions?: string[] | null;
}

const ISSUANCE_PROBE_MESSAGES: Record<IssuanceProbe, string> = {
  granted: 'KSeF token authenticated successfully and may issue invoices',
  missing:
    'KSeF token authenticated, but KSeF does not list the "wystawianie faktur" (InvoiceWrite) permission ' +
    'for it - issuing may be refused. Generate a token with that permission if invoices fail with 403.',
  unknown:
    'KSeF token authenticated successfully; KSeF did not answer the permission check, so whether it may ' +
    'issue invoices was not verified',
};
