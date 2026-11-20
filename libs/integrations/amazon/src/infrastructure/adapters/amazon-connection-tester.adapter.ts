/**
 * Amazon Connection Tester
 *
 * "Test connection" for an Amazon connection. Mints an LWA token and calls
 * `GET /sellers/v1/marketplaceParticipations`, which proves in one request
 * that the credentials work and tells which marketplaces the seller sells in.
 *
 * On `production` the configured marketplaces must all be among the ones the
 * seller participates in; a missing one fails the test and is named, because
 * every later call for it would be refused. On `sandbox` that check is
 * skipped: the static sandbox answers one canned US marketplace whatever is
 * asked (#2881 Evidence #1), so a mismatch there says nothing.
 *
 * Failure messages are bounded strings. A network failure collapses to a fixed
 * sentence (the raw cause can name the host), and nothing echoes a credential.
 *
 * @module libs/integrations/amazon/src/infrastructure/adapters
 * @implements {ConnectionTesterPort}
 */
import type { Connection } from '@openlinker/core/identifier-mapping';
import type {
  ConnectionTestResult,
  ConnectionTesterPort,
  CredentialsResolverPort,
} from '@openlinker/core/integrations';
import type { CachePort } from '@openlinker/shared';
import type { HttpTransportFactoryPort } from '@openlinker/shared/http';

import { AMAZON_MARKETPLACE_PARTICIPATIONS_PATH } from '../../amazon.constants';
import { AmazonAdapterFactory } from '../../application/amazon-adapter.factory';
import type { IAmazonAdapterFactory } from '../../application/interfaces/amazon-adapter.factory.interface';
import { AmazonApiError } from '../../domain/exceptions/amazon-api.error';
import { AmazonAuthenticationError } from '../../domain/exceptions/amazon-authentication.error';
import { AmazonConfigException } from '../../domain/exceptions/amazon-config.exception';
import { AmazonNetworkError } from '../../domain/exceptions/amazon-network.error';
import type { AmazonMarketplaceParticipationsResponse } from '../../domain/types/amazon-api.types';

export class AmazonConnectionTesterAdapter implements ConnectionTesterPort {
  constructor(
    private readonly http: HttpTransportFactoryPort,
    private readonly cache?: CachePort,
    private readonly factory: IAmazonAdapterFactory = new AmazonAdapterFactory(),
  ) {}

  async test(connection: Connection, credentialsResolver: CredentialsResolverPort): Promise<ConnectionTestResult> {
    const startedAt = Date.now();
    try {
      const resolution = await this.factory.resolve(
        connection,
        credentialsResolver,
        this.http.forConnection(connection),
        this.cache,
      );
      const response = await resolution.client.get<AmazonMarketplaceParticipationsResponse>(
        AMAZON_MARKETPLACE_PARTICIPATIONS_PATH,
      );
      const latencyMs = Date.now() - startedAt;
      const participating = readParticipatingIds(response.data);

      if (resolution.config.environment === 'sandbox') {
        return {
          success: true,
          status: response.status,
          message: 'Connected to the Amazon sandbox. Marketplaces are not checked there: it answers canned data.',
          latencyMs,
        };
      }

      const missing = resolution.config.marketplaceIds.filter((id) => !participating.has(id));
      if (missing.length > 0) {
        return {
          success: false,
          status: response.status,
          message: `Credentials work, but this seller does not sell in: ${missing.join(', ')}`,
          latencyMs,
        };
      }
      return {
        success: true,
        status: response.status,
        message: `Connected. Selling in ${resolution.config.marketplaceIds.join(', ')}`,
        latencyMs,
      };
    } catch (error) {
      return toFailure(error, Date.now() - startedAt);
    }
  }
}

function readParticipatingIds(data: AmazonMarketplaceParticipationsResponse): Set<string> {
  const ids = new Set<string>();
  for (const entry of data.payload ?? []) {
    const id = entry.marketplace?.id;
    if (typeof id === 'string' && entry.participation?.isParticipating !== false) {
      ids.add(id);
    }
  }
  return ids;
}

function toFailure(error: unknown, latencyMs: number): ConnectionTestResult {
  if (error instanceof AmazonAuthenticationError) {
    return {
      success: false,
      status: 401,
      outcome: 'unauthorized',
      message: 'Amazon refused the credentials. Check the client id and secret, or authorize the app again.',
      latencyMs,
    };
  }
  if (error instanceof AmazonApiError && error.statusCode === 429) {
    // `getMarketplaceParticipations` allows 0.016 req/s, burst 15 (Sellers API v1 model).
    return {
      success: false,
      status: 429,
      message: 'Amazon allows about one connection test a minute. Try again shortly.',
      latencyMs,
    };
  }
  if (error instanceof AmazonApiError && error.statusCode === 403) {
    // The token was just minted, so a 403 is the app lacking a role for this
    // API, not a rejected credential (see the auth-failure classifier).
    return {
      success: false,
      status: 403,
      outcome: 'misconfigured',
      message:
        'Amazon refused the call: the app lacks a role for this API. Add the roles in Developer Central, then authorize the app again.',
      latencyMs,
    };
  }
  if (error instanceof AmazonApiError) {
    return { success: false, status: error.statusCode, message: error.message, latencyMs };
  }
  if (error instanceof AmazonConfigException) {
    return { success: false, status: undefined, outcome: 'misconfigured', message: error.message, latencyMs };
  }
  if (error instanceof AmazonNetworkError) {
    return {
      success: false,
      status: undefined,
      outcome: error.timedOut ? 'timeout' : 'unreachable',
      message: 'Amazon could not be reached (network error)',
      latencyMs,
    };
  }
  return { success: false, status: undefined, message: 'Amazon connection test failed', latencyMs };
}
