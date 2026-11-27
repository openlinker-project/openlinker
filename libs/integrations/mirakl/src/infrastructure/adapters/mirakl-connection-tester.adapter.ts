/**
 * Mirakl Connection Tester
 *
 * Probes a Mirakl connection with one authenticated read, A01
 * `GET /api/account`, so the operator sees the connection work (or a clear
 * failure) right after pasting the shop key. A01 needs a valid key (a wrong
 * one, or a staging key against production, answers 401), takes no
 * parameters and changes nothing. Verified on Empik staging.
 *
 * The probe uses a no-retry client so a failing test answers at once.
 * Failures are sanitised as in the Erli tester: transport errors collapse to a
 * fixed sentence, because their messages can name internal hosts.
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters
 * @see {@link ConnectionTesterPort}
 */
import type {
  ConnectionTesterPort,
  ConnectionTestResult,
  CredentialsResolverPort,
} from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { HttpTransportFactoryPort } from '@openlinker/shared/http';
import type { IMiraklAdapterFactory } from '../../application/interfaces/mirakl-adapter.factory.interface';
import { MiraklApiException } from '../../domain/exceptions/mirakl-api.exception';
import { MiraklAuthenticationException } from '../../domain/exceptions/mirakl-authentication.exception';
import { MiraklConfigException } from '../../domain/exceptions/mirakl-config.exception';
import { MiraklNetworkException } from '../../domain/exceptions/mirakl-network.exception';
import { MiraklRateLimitException } from '../../domain/exceptions/mirakl-rate-limit.exception';

/** A01: shop account read. */
export const MIRAKL_CONNECTION_PROBE_PATH = '/api/account';

const NO_RETRY = { maxRetries: 0, initialDelayMs: 0, maxDelayMs: 0, backoffMultiplier: 1 } as const;

export class MiraklConnectionTesterAdapter implements ConnectionTesterPort {
  constructor(
    private readonly http: HttpTransportFactoryPort,
    private readonly factory: IMiraklAdapterFactory,
    private readonly brand: string,
  ) {}

  async test(
    connection: Connection,
    credentialsResolver: CredentialsResolverPort,
  ): Promise<ConnectionTestResult> {
    const startedAt = Date.now();
    try {
      const { httpClient } = await this.factory.createClients(
        connection,
        credentialsResolver,
        this.http.forConnection(connection),
        NO_RETRY,
      );
      const response = await httpClient.get(MIRAKL_CONNECTION_PROBE_PATH);
      return {
        success: true,
        status: response.status,
        message: 'Connection reachable and credentials accepted',
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      return this.toFailure(error, Date.now() - startedAt);
    }
  }

  private toFailure(error: unknown, latencyMs: number): ConnectionTestResult {
    if (error instanceof MiraklRateLimitException) {
      return {
        success: false,
        status: 429,
        message: `${this.brand} rate limit reached while probing the connection`,
        latencyMs,
      };
    }
    if (error instanceof MiraklNetworkException) {
      return {
        success: false,
        status: undefined,
        outcome: 'unreachable',
        message: `${this.brand} connection failed (network error)`,
        latencyMs,
      };
    }
    if (error instanceof MiraklConfigException) {
      return { success: false, status: undefined, outcome: 'misconfigured', message: error.message, latencyMs };
    }
    if (error instanceof MiraklAuthenticationException || error instanceof MiraklApiException) {
      return { success: false, status: error.statusCode, message: error.message, latencyMs };
    }
    return { success: false, status: undefined, message: `${this.brand} probe failed`, latencyMs };
  }
}
