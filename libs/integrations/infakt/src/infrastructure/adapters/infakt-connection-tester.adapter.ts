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
 * Logs the resolved environment + host before probing (#2179 review round 3,
 * Suggestion #2): sandbox vs production is the difference between a test
 * document and a legally issued invoice, so which host a "Test connection"
 * click actually reached must be answerable from the log. A `baseUrl` that
 * fails the https guard surfaces as a FAILED result naming the fix, never as
 * an unhandled 500.
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
import type { HttpTransportFactoryPort } from '@openlinker/shared/http';
import { InfaktHttpClient } from '../http/infakt-http-client';
import { InfaktApiError } from '../../domain/exceptions/infakt-api.error';
import { InfaktConfigException } from '../../domain/exceptions/infakt-config.exception';
import {
  describeInfaktTarget,
  resolveInfaktBaseUrl,
} from '../../domain/policies/infakt-base-url.policy';
import type { InfaktCredentials, InfaktConnectionConfig } from '../../domain/types/infakt-connection.types';

const INFAKT_CONNECTION_PROBE_PATH = 'clients.json';

export class InfaktConnectionTesterAdapter implements ConnectionTesterPort {
  private readonly logger = new Logger(InfaktConnectionTesterAdapter.name);

  constructor(private readonly http: HttpTransportFactoryPort) {}

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
      // Connection-bound outbound transport (#1810) — a "Test connection"
      // click is operator-triggered and can be repeated in quick succession;
      // it must go through the same rate limiter as every other Infakt call
      // site, not a bare globalThis.fetch.
      const fetchImpl = this.http.forConnection(connection);
      const baseUrl = resolveInfaktBaseUrl(config, connection.id);
      this.logger.log(
        `Infakt connection ${connection.id} probe target: ${describeInfaktTarget(config, baseUrl)}`,
      );
      const client = new InfaktHttpClient(
        { apiKey: credentials.apiKey, baseUrl },
        this.logger,
        fetchImpl,
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
    // A misconfigured connection is an operator-fixable state, not an internal
    // fault (#2179 review round 3, Important #1): `resolveInfaktBaseUrl` throws
    // this for a non-https legacy `baseUrl` override, and it must read as an
    // actionable failed test rather than collapsing into the opaque catch-all
    // below (or, worse, escaping as a 500). The message is OL-authored and
    // carries no credential.
    if (error instanceof InfaktConfigException) {
      return {
        success: false,
        status: undefined,
        // The exception message is OL-authored and bounded, so it is forwarded
        // verbatim rather than flattened - it names the offending field, which
        // is the whole point of surfacing this separately.
        message: `Infakt connection configuration is invalid: ${error.message}`,
        latencyMs,
      };
    }
    // Anything else (raw fetch/undici error, credential-resolution failure)
    // collapses to a fixed string — never let an internal detail leak.
    return { success: false, status: undefined, message: 'Infakt probe failed', latencyMs };
  }
}
