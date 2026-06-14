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
import { ErliAuthenticationException } from '../../domain/exceptions/erli-authentication.exception';

/**
 * PLACEHOLDER probe path — replaced by #992 with a confirmed cheap
 * authenticated Erli endpoint. Must require auth so a bad key returns 401/403.
 */
const ERLI_CONNECTION_PROBE_PATH = '/offers?limit=1';

/** No-retry budget: a connection probe should fail fast, not back off. */
const NO_RETRY = { maxRetries: 0, initialDelayMs: 0, maxDelayMs: 0, backoffMultiplier: 1 } as const;

export class ErliConnectionTesterAdapter implements ConnectionTesterPort {
  constructor(private readonly factory: ErliAdapterFactory = new ErliAdapterFactory()) {}

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
        message: 'OK',
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      return this.toFailure(error, Date.now() - startedAt);
    }
  }

  private toFailure(error: unknown, latencyMs: number): ConnectionTestResult {
    if (error instanceof ErliAuthenticationException) {
      return { success: false, status: error.statusCode, message: error.message, latencyMs };
    }
    const err = error as { statusCode?: number; message?: string };
    return {
      success: false,
      status: typeof err.statusCode === 'number' ? err.statusCode : undefined,
      message: err.message ?? 'Erli probe failed',
      latencyMs,
    };
  }
}
