/**
 * Shopify Connection Tester
 *
 * "Test connection": mints (or uses) the token and runs one cheap query -
 * the shop, the app's granted scopes and the primary location. A token that
 * works but lacks a scope the capabilities need is reported as a failure
 * naming the missing scopes, because otherwise the first job needing one
 * fails with `ACCESS_DENIED` long after the operator saw a green test.
 *
 * Goes through the connection-bound transport like every other call (#1810).
 *
 * @module libs/integrations/shopify/src/infrastructure/adapters
 */
import type {
  ConnectionTesterPort,
  ConnectionTestResult,
  CredentialsResolverPort,
} from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { CachePort } from '@openlinker/shared';
import type { HttpTransportFactoryPort } from '@openlinker/shared/http';
import { Logger } from '@openlinker/shared/logging';
import type { ConnectionRateLimit } from '@openlinker/shared/rate-limit';

import { SHOPIFY_REQUIRED_SCOPES } from '../../shopify.constants';
import { ShopifyApiError } from '../../domain/exceptions/shopify-api.error';
import { ShopifyConfigException } from '../../domain/exceptions/shopify-config.exception';
import { ShopifyGraphqlError } from '../../domain/exceptions/shopify-graphql.error';
import { ShopifyNetworkError } from '../../domain/exceptions/shopify-network.error';
import type { ShopifyShopInfo } from '../../domain/types/shopify-api.types';
import { buildShopifyClient, type ShopifyTokenMemo } from '../http/shopify-client.builder';

const TEST_QUERY = `query OlConnectionTest {
  shop { name currencyCode taxesIncluded }
  currentAppInstallation { accessScopes { handle } }
}`;

interface TestQuery {
  readonly shop: ShopifyShopInfo;
  readonly currentAppInstallation: { readonly accessScopes: ReadonlyArray<{ readonly handle: string }> };
}

export class ShopifyConnectionTesterAdapter implements ConnectionTesterPort {
  private readonly logger = new Logger(ShopifyConnectionTesterAdapter.name);

  constructor(
    private readonly http: HttpTransportFactoryPort,
    private readonly defaultRateLimit: ConnectionRateLimit | undefined,
    private readonly cache: CachePort | undefined,
    private readonly tokenMemo: ShopifyTokenMemo,
  ) {}

  async test(connection: Connection, credentialsResolver: CredentialsResolverPort): Promise<ConnectionTestResult> {
    const startedAt = Date.now();
    const elapsed = (): number => Date.now() - startedAt;
    try {
      const { client } = await buildShopifyClient(
        connection,
        credentialsResolver,
        this.http.forConnection(connection, this.defaultRateLimit),
        this.cache,
        this.tokenMemo,
      );
      const data = await client.query<TestQuery>(TEST_QUERY);
      const granted = new Set(data.currentAppInstallation.accessScopes.map((s) => s.handle));
      // A write scope implies its read scope on Shopify.
      const missing = SHOPIFY_REQUIRED_SCOPES.filter(
        (scope) => !granted.has(scope) && !granted.has(scope.replace(/^read_/, 'write_')),
      );
      if (missing.length > 0) {
        return {
          success: false,
          message: `Connected to ${data.shop.name}, but the app lacks scopes: ${missing.join(', ')}`,
          latencyMs: elapsed(),
        };
      }
      return {
        success: true,
        message: `OK - ${data.shop.name} (${data.shop.currencyCode}, prices ${
          data.shop.taxesIncluded ? 'include' : 'exclude'
        } tax)`,
        latencyMs: elapsed(),
      };
    } catch (error) {
      return this.toFailure(error, connection.id, elapsed());
    }
  }

  private toFailure(error: unknown, connectionId: string, latencyMs: number): ConnectionTestResult {
    if (error instanceof ShopifyConfigException) {
      return { success: false, message: error.message, latencyMs };
    }
    if (error instanceof ShopifyApiError) {
      const message =
        error.statusCode === 401
          ? 'Shopify rejected the access token - check it, or the app client id and secret'
          : error.statusCode === 400
            ? 'Shopify refused the token request - check the app client id and secret, and that the app is installed on the store'
            : error.statusCode === 404
              ? 'Shopify Admin API not found - verify the store domain and API version'
              : `Shopify returned HTTP ${error.statusCode}`;
      return { success: false, status: error.statusCode, message, latencyMs };
    }
    if (error instanceof ShopifyGraphqlError) {
      return { success: false, message: error.message, latencyMs };
    }
    if (error instanceof ShopifyNetworkError) {
      this.logger.warn('Shopify connection test failed', { connectionId, error: error.message });
      return {
        success: false,
        message: error.timedOut ? 'Shopify did not respond in time' : error.message,
        latencyMs,
      };
    }
    const message = error instanceof Error ? error.message : 'Shopify connection test failed';
    this.logger.warn('Shopify connection test failed unexpectedly', { connectionId, error: message });
    return { success: false, message, latencyMs };
  }
}
