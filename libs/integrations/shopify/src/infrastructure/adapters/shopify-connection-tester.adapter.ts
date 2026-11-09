/**
 * Shopify Connection Tester
 *
 * "Test connection": obtains the token (minting or refreshing it when the
 * mode needs to), reads the shop, the app's granted scopes and the location
 * OpenLinker will work against, and reports shop name, currency, whether
 * prices include tax, and the location name. A configured location the shop
 * does not list fails naming `locationId` (K06). A token that works but lacks
 * a scope the capabilities need fails naming the scopes, because Shopify
 * refuses an unscoped field only on the first job that needs it.
 *
 * A refused token request is told apart by its grant error (K02, K03, G03):
 * an app not installed on the store, a store in another organization (client
 * credentials cannot reach it, OAuth is needed), or a wrong client id/secret.
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

import { ShopifyApiError } from '../../domain/exceptions/shopify-api.error';
import { ShopifyConfigException } from '../../domain/exceptions/shopify-config.exception';
import { ShopifyGraphqlError } from '../../domain/exceptions/shopify-graphql.error';
import { ShopifyNetworkError } from '../../domain/exceptions/shopify-network.error';
import {
  findMissingOptionalShopifyScopes,
  findMissingShopifyScopes,
} from '../../domain/policies/shopify-scopes.policy';
import { resolveShopifyRateLimitBucketKey } from '../../domain/policies/shopify-rate-limit-bucket.policy';
import { buildShopifyClient, type ShopifyClientRuntime } from '../http/shopify-client.builder';
import { ShopifyShopContextProvider } from '../shop-context/shopify-shop-context.provider';
import { SHOPIFY_OPTIONAL_SCOPE_EFFECTS } from '../../shopify.constants';

const SCOPES_QUERY = `query OlConnectionTestScopes {
  currentAppInstallation { accessScopes { handle } }
}`;

interface ScopesQuery {
  readonly currentAppInstallation: {
    readonly accessScopes: ReadonlyArray<{ readonly handle: string }>;
  };
}

/** Operator-facing sentence for a refused token request, keyed by the grant error code. */
export function describeShopifyTokenRefusal(grantError: string | null): string {
  switch (grantError) {
    case 'app_not_installed':
      return 'The Shopify app is not installed on this store - install it from the Dev Dashboard, then test again';
    case 'shop_not_permitted':
      return 'This store is outside the app\'s organization, so client credentials cannot reach it - connect it with OAuth instead';
    case 'invalid_grant':
      return 'Shopify no longer accepts the OAuth grant - reconnect the store with OAuth';
    case 'invalid_client':
    case 'application_cannot_be_found':
    case 'unauthorized_client':
      return 'Shopify did not accept the app client id and secret - check both';
    default:
      return 'Shopify refused the token request - check the app client id and secret, and that the app is installed on the store';
  }
}

/** A passing test still names an optional scope the app lacks, and what it switches off. */
function describeMissingOptionalScopes(missing: readonly string[]): string {
  if (missing.length === 0) {
    return '';
  }
  const effects = missing.map(
    (scope) =>
      `${scope} (${SHOPIFY_OPTIONAL_SCOPE_EFFECTS[scope as keyof typeof SHOPIFY_OPTIONAL_SCOPE_EFFECTS] ?? 'optional'})`,
  );
  return `. The app lacks optional scopes until granted: ${effects.join('; ')}`;
}

export class ShopifyConnectionTesterAdapter implements ConnectionTesterPort {
  private readonly logger = new Logger(ShopifyConnectionTesterAdapter.name);

  constructor(
    private readonly http: HttpTransportFactoryPort,
    private readonly defaultRateLimit: ConnectionRateLimit | undefined,
    private readonly cache: CachePort | undefined,
    private readonly runtime: ShopifyClientRuntime,
  ) {}

  async test(connection: Connection, credentialsResolver: CredentialsResolverPort): Promise<ConnectionTestResult> {
    const startedAt = Date.now();
    const elapsed = (): number => Date.now() - startedAt;
    try {
      const { config, client } = await buildShopifyClient(
        connection,
        credentialsResolver,
        this.http.forConnection(connection, this.defaultRateLimit, {
          bucketKey: resolveShopifyRateLimitBucketKey(connection),
        }),
        this.cache,
        this.runtime,
      );
      const context = await new ShopifyShopContextProvider(
        client,
        connection.id,
        config.locationGid,
        // No cache: a test must read the shop as it is now, not a context
        // cached before the operator fixed the config.
        undefined,
      ).get();
      const scopes = await client.query<ScopesQuery>(SCOPES_QUERY);
      const granted = new Set(scopes.currentAppInstallation.accessScopes.map((s) => s.handle));
      const missing = findMissingShopifyScopes(granted);
      if (missing.length > 0) {
        return {
          success: false,
          message: `Connected to ${context.shopName}, but the app lacks scopes: ${missing.join(', ')}`,
          latencyMs: elapsed(),
        };
      }
      return {
        success: true,
        message:
          `OK - ${context.shopName} (${context.currencyCode}, prices ` +
          `${context.taxesIncluded ? 'include' : 'exclude'} tax, location ${context.locationName})` +
          describeMissingOptionalScopes(findMissingOptionalShopifyScopes(granted)),
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
      const message = error.isTokenRequestRefused()
        ? describeShopifyTokenRefusal(error.grantError)
        : error.statusCode === 401
          ? 'Shopify rejected the access token - replace it, or reconnect the store'
          : error.statusCode === 402
            ? 'The Shopify store is frozen (unpaid plan)'
            : error.statusCode === 404
              ? 'Shopify Admin API not found - verify the store domain'
              : `Shopify returned HTTP ${error.statusCode}`;
      return { success: false, status: error.statusCode, message, latencyMs };
    }
    if (error instanceof ShopifyGraphqlError) {
      const message = error.isInvalidToken()
        ? 'Shopify rejected the access token - replace it, or reconnect the store'
        : error.isAccessDenied()
          ? 'The Shopify app lacks a scope needed to read the shop and its locations (read_locations)'
          : error.message;
      return { success: false, message, latencyMs };
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
