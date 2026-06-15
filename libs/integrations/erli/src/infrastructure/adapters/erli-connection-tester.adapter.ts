/**
 * Erli Connection Tester
 *
 * Probes a live Erli connection with one cheap authenticated GET so OL Admin
 * can show the connection Active (or a clear failure) right after the operator
 * pastes their API key. Builds a no-retry per-connection client via
 * `ErliAdapterFactory` and maps the outcome to the neutral
 * `ConnectionTestResult`. Registered against `ConnectionTesterRegistryService`
 * at `erli.shopapi.v1`.
 *
 * NOTE (#992): the probe PATH below is a PLACEHOLDER. The live Erli Shop API
 * endpoint set is not confirmed until the #992 sandbox verification spike, so
 * this is not yet a live-verified probe. The tester's auth/result logic is
 * endpoint-agnostic and the unit tests mock `fetch`; `ERLI_CONNECTION_PROBE_PATH`
 * is the single line #992 updates once a confirmed cheap authenticated
 * endpoint is known.
 *
 * @module libs/integrations/erli/src/infrastructure/adapters
 * @see {@link ConnectionTesterPort}
 */
import type {
  ConnectionTesterPort,
  ConnectionTestResult,
  CredentialsResolverPort,
} from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { ErliAdapterFactory } from '../../application/erli-adapter.factory';
import type { IErliAdapterFactory } from '../../application/interfaces/erli-adapter.factory.interface';
import { ErliApiException } from '../../domain/exceptions/erli-api.exception';
import { ErliAuthenticationException } from '../../domain/exceptions/erli-authentication.exception';
import { ErliConfigException } from '../../domain/exceptions/erli-config.exception';
import { ErliNetworkException } from '../../domain/exceptions/erli-network.exception';
import { ErliRateLimitException } from '../../domain/exceptions/erli-rate-limit.exception';

/**
 * PLACEHOLDER probe path — replaced by #992 with a confirmed cheap
 * authenticated Erli endpoint. Must require auth so a bad key returns 401/403.
 */
const ERLI_CONNECTION_PROBE_PATH = '/offers?limit=1';

/** No-retry budget: a connection probe should fail fast, not back off. */
const NO_RETRY = { maxRetries: 0, initialDelayMs: 0, maxDelayMs: 0, backoffMultiplier: 1 } as const;

export class ErliConnectionTesterAdapter implements ConnectionTesterPort {
  // Depends on the IErliAdapterFactory abstraction (defaulting to the concrete
  // factory) so the construction seam is injectable and the infra→application
  // edge is against an interface, not a concrete application class.
  constructor(private readonly factory: IErliAdapterFactory = new ErliAdapterFactory()) {}

  async test(
    connection: Connection,
    credentialsResolver: CredentialsResolverPort,
  ): Promise<ConnectionTestResult> {
    const startedAt = Date.now();
    try {
      const client = await this.factory.createHttpClient(connection, credentialsResolver, NO_RETRY);
      const response = await client.get(ERLI_CONNECTION_PROBE_PATH);
      return {
        success: true,
        status: response.status,
        // The probe endpoint is provisional until the #992 sandbox spike confirms
        // it actually requires auth. Until then a 2xx proves reachability but not
        // a verified credential, so the message stays conservative (#982/#992).
        message: 'Connection reachable (probe endpoint provisional until #992)',
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      return this.toFailure(error, Date.now() - startedAt);
    }
  }

  private toFailure(error: unknown, latencyMs: number): ConnectionTestResult {
    // Only a recognized Erli exception's message/status reaches the
    // operator-facing result: their messages are bounded and never carry the
    // bearer key. Any other error (e.g. a raw fetch/undici error, whose message
    // can embed internal request details) collapses to a fixed string so
    // nothing unexpected is surfaced in OL Admin.
    if (
      error instanceof ErliAuthenticationException ||
      error instanceof ErliApiException ||
      error instanceof ErliNetworkException ||
      error instanceof ErliConfigException ||
      error instanceof ErliRateLimitException
    ) {
      const status = 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : undefined;
      return { success: false, status, message: error.message, latencyMs };
    }
    return { success: false, status: undefined, message: 'Erli probe failed', latencyMs };
  }
}
