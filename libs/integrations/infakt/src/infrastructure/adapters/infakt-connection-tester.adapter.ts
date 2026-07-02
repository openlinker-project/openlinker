/**
 * Infakt Connection Tester
 *
 * Probes a live Infakt connection with one cheap authenticated GET so OL Admin
 * can show the connection Active (or a clear failure) right after the operator
 * pastes their API key. Resolves credentials directly and builds a bare
 * `InfaktHttpClient` (mirrors the `SubiektConnectionTesterAdapter` precedent —
 * Infakt's factory only exposes `createInvoicingAdapter`, not a standalone
 * HTTP-client construction seam) and maps the outcome to the neutral
 * `ConnectionTestResult`. Registered against `ConnectionTesterRegistryService`
 * at `infakt.accounting.v1`.
 *
 * The probe path ({@link INFAKT_CONNECTION_PROBE_PATH}) is `GET /clients.json`
 * with `limit=1` — a real, already-used Infakt v3 endpoint (see
 * `InfaktInvoicingAdapter.findClientByNip`), cheap, side-effect-free, and
 * requires a valid API key so a 2xx confirms both reachability and credential
 * validity, same posture as Erli's `GET /me`.
 *
 * @module libs/integrations/infakt/src/infrastructure/adapters
 * @see {@link ConnectionTesterPort}
 */
import type {
  ConnectionTesterPort,
  ConnectionTestResult,
  CredentialsResolverPort,
} from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';
import { InfaktHttpClient, INFAKT_DEFAULT_BASE_URL } from '../http/infakt-http-client';
import { InfaktApiError } from '../../domain/exceptions/infakt-api.error';
import type { InfaktCredentials, InfaktConnectionConfig } from '../../domain/types/infakt-connection.types';

const INFAKT_CONNECTION_PROBE_PATH = 'clients.json';

export class InfaktConnectionTesterAdapter implements ConnectionTesterPort {
  private readonly logger = new Logger(InfaktConnectionTesterAdapter.name);

  async test(
    connection: Connection,
    credentialsResolver: CredentialsResolverPort,
  ): Promise<ConnectionTestResult> {
    const startedAt = Date.now();
    try {
      if (!connection.credentialsRef) {
        return {
          success: false,
          message: 'Connection has no stored credentials',
          latencyMs: Date.now() - startedAt,
        };
      }

      const credentials = await credentialsResolver.get<InfaktCredentials>(connection.credentialsRef);
      const config = (connection.config ?? {}) as InfaktConnectionConfig;
      const client = new InfaktHttpClient(
        { apiKey: credentials.apiKey, baseUrl: config.baseUrl ?? INFAKT_DEFAULT_BASE_URL },
        this.logger,
      );

      await client.get(INFAKT_CONNECTION_PROBE_PATH, { limit: '1' });

      return {
        success: true,
        status: 200,
        // GET /clients.json requires auth, so a 2xx confirms both reachability
        // and a valid credential.
        message: 'Connection reachable and credentials accepted',
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      return this.toFailure(error, Date.now() - startedAt);
    }
  }

  private toFailure(error: unknown, latencyMs: number): ConnectionTestResult {
    // InfaktApiError.message is bounded and bearer-safe; responseBody is a
    // SEPARATE field that may echo back submitted data and must never reach
    // the operator-facing result.
    if (error instanceof InfaktApiError) {
      return { success: false, status: error.statusCode, message: error.message, latencyMs };
    }
    // Anything else (raw fetch/undici error, credential-resolution failure)
    // collapses to a fixed string — never let an internal detail leak.
    return { success: false, status: undefined, message: 'Infakt probe failed', latencyMs };
  }
}
