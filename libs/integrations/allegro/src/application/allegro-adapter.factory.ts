/**
 * Allegro Adapter Factory
 *
 * Creates Allegro adapter instances from Connection entities. Validates
 * configuration, resolves credentials, and injects all dependencies.
 *
 * @module libs/integrations/allegro/src/application
 * @implements {IAllegroAdapterFactory}
 */
import {
  IAllegroAdapterFactory,
  AllegroAdapters,
} from './interfaces/allegro-adapter.factory.interface';
import { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { CredentialsResolverPort } from '@openlinker/core/integrations';
import { CustomerIdentityResolverPort } from '@openlinker/core/customers';
import {
  AllegroConnectionConfig,
  AllegroEnvironmentValues,
} from '../domain/types/allegro-config.types';
import { AllegroCredentials } from '../domain/types/allegro-credentials.types';
import { AllegroConfigException } from '../domain/exceptions/allegro-config.exception';
import { AllegroHttpClient } from '../infrastructure/http/allegro-http-client';
import { AllegroConnectionTokenState } from '../infrastructure/http/allegro-connection-token-state';
import {
  AllegroOfferManagerAdapter,
  QuantityPollConfig,
} from '../infrastructure/adapters/allegro-offer-manager.adapter';
import { AllegroOrderSourceAdapter } from '../infrastructure/adapters/allegro-order-source.adapter';
import { TokenRefreshResult } from '../infrastructure/http/allegro-http-client.types';
import { AllegroTokenRefreshService } from '../infrastructure/token-refresh/allegro-token-refresh.service';
import { Logger } from '@openlinker/shared/logging';
import type { CachePort } from '@openlinker/shared';
import { AllegroQuantityCommandRepositoryPort } from '../domain/ports/allegro-quantity-command-repository.port';

/**
 * Allegro Adapter Factory
 *
 * Creates and configures Allegro adapter instances.
 */
export class AllegroAdapterFactory implements IAllegroAdapterFactory {
  private readonly logger = new Logger(AllegroAdapterFactory.name);

  constructor(
    // Retained on the constructor for backwards-compat with existing NestJS
    // wiring. The post-#328 adapters do not consume the customer identity
    // resolver directly — identity resolution lives in OrderIngestionService.
    _customerIdentityResolver?: CustomerIdentityResolverPort,
    private readonly tokenRefreshService?: AllegroTokenRefreshService,
    private readonly commandRepository?: AllegroQuantityCommandRepositoryPort,
    private readonly quantityPollConfig?: Partial<QuantityPollConfig>,
    /** Distributed cache for category parameters (#410). Optional; missing → no caching. */
    private readonly cache?: CachePort,
    /** TTL override for the category parameters cache in seconds. Defaults to 24h. */
    private readonly catParamsTtlSec?: number,
  ) {
    void _customerIdentityResolver;
  }

  async createAdapters(
    connection: Connection,
    identifierMapping: IdentifierMappingPort,
    credentialsResolver: CredentialsResolverPort
  ): Promise<AllegroAdapters> {
    this.logger.debug(`Creating Allegro adapters for connection: ${connection.id}`);

    // Validate and parse config
    const config = this.validateConfig(connection);

    // Resolve credentials
    const credentials = await this.resolveCredentials(connection, credentialsResolver);

    // Determine API + upload base URLs
    const apiBaseUrl = config.apiBaseUrl || this.getDefaultApiBaseUrl(config.environment);
    const uploadBaseUrl = config.uploadBaseUrl || this.getDefaultUploadBaseUrl(config.environment);
    // #464 — public buyer-facing storefront, used by `OfferReader.getOffer` to
    // synthesise a marketplace-side URL the operator can open in a new tab.
    const storefrontBaseUrl = this.getDefaultStorefrontBaseUrl(config.environment);

    // Create token refresh callback if token refresh service is available.
    // We forward both accessToken and expiresAt so the HTTP client can update
    // its cached expiry and avoid immediately re-triggering a proactive
    // refresh on the next request.
    const tokenRefreshCallback = this.tokenRefreshService
      ? async (_connectionId: string): Promise<TokenRefreshResult> => {
          const refreshResponse = await this.tokenRefreshService!.refreshToken(
            connection,
            credentialsResolver
          );
          return {
            accessToken: refreshResponse.accessToken,
            expiresAt: refreshResponse.expiresAt,
          };
        }
      : undefined;

    // One token state shared between both HTTP clients so a refresh triggered
    // by either client is immediately visible to the other (no wasted 401
    // round-trip on the sibling client after rotation).
    const tokenState = new AllegroConnectionTokenState(
      connection.id,
      credentials,
      tokenRefreshCallback,
    );

    // Two HTTP clients per connection — one for api.allegro.pl, one for
    // upload.allegro.pl. They share the token state above.
    const httpClient = new AllegroHttpClient(connection.id, apiBaseUrl, tokenState);
    const uploadHttpClient = new AllegroHttpClient(connection.id, uploadBaseUrl, tokenState);

    // The offer-manager adapter needs both clients (api for offer CRUD,
    // upload for `POST /sale/images`). The order-source adapter only ever
    // talks to the api host.
    const offerManagerAdapter = new AllegroOfferManagerAdapter(
      connection.id,
      httpClient,
      uploadHttpClient,
      identifierMapping,
      connection,
      this.commandRepository,
      this.quantityPollConfig,
      this.cache,
      this.catParamsTtlSec,
      // #430 — connection-level seller defaults sourced from
      // `Connection.config.allegro.sellerDefaults`. Passed through unparsed
      // (the API DTO layer validates province enum / postcode regex /
      // discriminated safetyInformation before persistence). Undefined when
      // operator hasn't configured them yet — adapter throws
      // `OfferCreateRejectedException` on the first offer attempt.
      config.sellerDefaults,
      storefrontBaseUrl,
    );
    const orderSourceAdapter = new AllegroOrderSourceAdapter(connection.id, httpClient, connection);

    this.logger.log(`Allegro adapters created successfully for connection: ${connection.id}`);

    return {
      offerManager: offerManagerAdapter,
      orderSource: orderSourceAdapter,
    };
  }

  /**
   * Get default API base URL for environment
   */
  private getDefaultApiBaseUrl(environment: string): string {
    switch (environment) {
      case 'sandbox':
        return 'https://api.allegro.pl.allegrosandbox.pl';
      case 'production':
        return 'https://api.allegro.pl';
      default:
        this.logger.warn(`Unknown environment: ${environment}, defaulting to sandbox`);
        return 'https://api.allegro.pl.allegrosandbox.pl';
    }
  }

  /**
   * Public storefront base URL for the offer-detail link surfaced on the
   * listing-detail page (#464). Same `*.allegrosandbox.pl` naming pattern as
   * the api/upload hosts.
   */
  private getDefaultStorefrontBaseUrl(environment: string): string {
    switch (environment) {
      case 'sandbox':
        return 'https://allegro.pl.allegrosandbox.pl';
      case 'production':
        return 'https://allegro.pl';
      default:
        this.logger.warn(`Unknown environment: ${environment}, defaulting to sandbox storefront`);
        return 'https://allegro.pl.allegrosandbox.pl';
    }
  }

  /**
   * Get default image-upload base URL for environment.
   *
   * Allegro hosts image uploads on a separate domain (`upload.allegro.pl`)
   * from the rest of the API; the sandbox follows the same `*.allegrosandbox.pl`
   * naming pattern as the api host.
   */
  private getDefaultUploadBaseUrl(environment: string): string {
    switch (environment) {
      case 'sandbox':
        return 'https://upload.allegro.pl.allegrosandbox.pl';
      case 'production':
        return 'https://upload.allegro.pl';
      default:
        this.logger.warn(`Unknown environment: ${environment}, defaulting to sandbox`);
        return 'https://upload.allegro.pl.allegrosandbox.pl';
    }
  }

  /**
   * Validate and parse connection config
   */
  private validateConfig(connection: Connection): AllegroConnectionConfig {
    if (!connection.config) {
      throw new AllegroConfigException(
        `Connection ${connection.id} is missing config`,
        connection.id
      );
    }

    try {
      const config = connection.config as unknown as AllegroConnectionConfig;

      if (!config.environment) {
        throw new AllegroConfigException(
          `Connection ${connection.id} is missing environment in config`,
          connection.id
        );
      }

      if (!AllegroEnvironmentValues.includes(config.environment)) {
        throw new AllegroConfigException(
          `Connection ${connection.id} has invalid environment: ${config.environment}. Must be one of: ${AllegroEnvironmentValues.join(', ')}`,
          connection.id
        );
      }

      return config;
    } catch (error) {
      if (error instanceof AllegroConfigException) {
        throw error;
      }
      throw new AllegroConfigException(
        `Connection ${connection.id} has invalid config: ${(error as Error).message}`,
        connection.id
      );
    }
  }

  /**
   * Resolve credentials from credentialsRef
   */
  private async resolveCredentials(
    connection: Connection,
    credentialsResolver: CredentialsResolverPort
  ): Promise<AllegroCredentials> {
    if (!connection.credentialsRef) {
      throw new AllegroConfigException(
        `Connection ${connection.id} is missing credentialsRef`,
        connection.id
      );
    }

    try {
      const credentials = await credentialsResolver.get<AllegroCredentials>(
        connection.credentialsRef
      );

      if (!credentials.accessToken) {
        throw new AllegroConfigException(
          `Connection ${connection.id} credentials are missing accessToken`,
          connection.id
        );
      }

      return credentials;
    } catch (error) {
      if (error instanceof AllegroConfigException) {
        throw error;
      }
      throw new AllegroConfigException(
        `Failed to resolve credentials for connection ${connection.id}: ${(error as Error).message}`,
        connection.id
      );
    }
  }
}
