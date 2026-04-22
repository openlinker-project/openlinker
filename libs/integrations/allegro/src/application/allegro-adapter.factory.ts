/**
 * Allegro Adapter Factory
 *
 * Creates Allegro adapter instances from Connection entities. Validates
 * configuration, resolves credentials, and injects all dependencies.
 *
 * @module libs/integrations/allegro/src/application
 * @implements {IAllegroAdapterFactory}
 */
import { IAllegroAdapterFactory, AllegroAdapters } from './interfaces/allegro-adapter.factory.interface';
import { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { CredentialsResolverPort } from '@openlinker/core/integrations';
import { CustomerIdentityResolverPort } from '@openlinker/core/customers';
import { AllegroConnectionConfig, AllegroEnvironmentValues } from '../domain/types/allegro-config.types';
import { AllegroCredentials } from '../domain/types/allegro-credentials.types';
import { AllegroConfigException } from '../domain/exceptions/allegro-config.exception';
import { AllegroHttpClient } from '../infrastructure/http/allegro-http-client';
import {
  AllegroOfferManagerAdapter,
  QuantityPollConfig,
} from '../infrastructure/adapters/allegro-offer-manager.adapter';
import { AllegroOrderSourceAdapter } from '../infrastructure/adapters/allegro-order-source.adapter';
import { TokenRefreshResult } from '../infrastructure/http/allegro-http-client.types';
import { AllegroMarketplaceAdapter, QuantityPollConfig } from '../infrastructure/adapters/allegro-marketplace.adapter';
import { AllegroTokenRefreshService } from '../infrastructure/token-refresh/allegro-token-refresh.service';
import { Logger } from '@openlinker/shared/logging';
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
  ) {
    void _customerIdentityResolver;
  }

  async createAdapters(
    connection: Connection,
    identifierMapping: IdentifierMappingPort,
    credentialsResolver: CredentialsResolverPort,
  ): Promise<AllegroAdapters> {
    this.logger.debug(`Creating Allegro adapters for connection: ${connection.id}`);

    // Validate and parse config
    const config = this.validateConfig(connection);

    // Resolve credentials
    const credentials = await this.resolveCredentials(connection, credentialsResolver);

    // Determine API base URL
    const apiBaseUrl = config.apiBaseUrl || this.getDefaultApiBaseUrl(config.environment);

    // Create token refresh callback if token refresh service is available.
    // We forward both accessToken and expiresAt so the HTTP client can update
    // its cached expiry and avoid immediately re-triggering a proactive
    // refresh on the next request.
    const tokenRefreshCallback = this.tokenRefreshService
      ? async (_connectionId: string): Promise<TokenRefreshResult> => {
          const refreshResponse = await this.tokenRefreshService!.refreshToken(
            connection,
            credentialsResolver,
          );
          return {
            accessToken: refreshResponse.accessToken,
            expiresAt: refreshResponse.expiresAt,
          };
        }
      : undefined;

    // Create HTTP client
    const httpClient = new AllegroHttpClient(
      connection.id,
      apiBaseUrl,
      credentials,
      config,
      undefined, // retryConfig
      tokenRefreshCallback,
    );

    // Both adapters receive the single per-connection HTTP client + identifier-mapping
    // instance constructed above. This keeps token-refresh + rate-limit coordination
    // coherent across the offer-side and order-ingestion paths.
    const offerManagerAdapter = new AllegroOfferManagerAdapter(
      connection.id,
      httpClient,
      identifierMapping,
      connection,
      this.commandRepository,
      this.quantityPollConfig,
    );
    const orderSourceAdapter = new AllegroOrderSourceAdapter(
      connection.id,
      httpClient,
      connection,
    );

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
   * Validate and parse connection config
   */
  private validateConfig(connection: Connection): AllegroConnectionConfig {
    if (!connection.config) {
      throw new AllegroConfigException(
        `Connection ${connection.id} is missing config`,
        connection.id,
      );
    }

    try {
      const config = connection.config as unknown as AllegroConnectionConfig;

      if (!config.environment) {
        throw new AllegroConfigException(
          `Connection ${connection.id} is missing environment in config`,
          connection.id,
        );
      }

      if (!AllegroEnvironmentValues.includes(config.environment)) {
        throw new AllegroConfigException(
          `Connection ${connection.id} has invalid environment: ${config.environment}. Must be one of: ${AllegroEnvironmentValues.join(', ')}`,
          connection.id,
        );
      }

      return config;
    } catch (error) {
      if (error instanceof AllegroConfigException) {
        throw error;
      }
      throw new AllegroConfigException(
        `Connection ${connection.id} has invalid config: ${(error as Error).message}`,
        connection.id,
      );
    }
  }

  /**
   * Resolve credentials from credentialsRef
   */
  private async resolveCredentials(
    connection: Connection,
    credentialsResolver: CredentialsResolverPort,
  ): Promise<AllegroCredentials> {
    if (!connection.credentialsRef) {
      throw new AllegroConfigException(
        `Connection ${connection.id} is missing credentialsRef`,
        connection.id,
      );
    }

    try {
      const credentials = await credentialsResolver.get<AllegroCredentials>(
        connection.credentialsRef,
      );

      if (!credentials.accessToken) {
        throw new AllegroConfigException(
          `Connection ${connection.id} credentials are missing accessToken`,
          connection.id,
        );
      }

      return credentials;
    } catch (error) {
      if (error instanceof AllegroConfigException) {
        throw error;
      }
      throw new AllegroConfigException(
        `Failed to resolve credentials for connection ${connection.id}: ${(error as Error).message}`,
        connection.id,
      );
    }
  }
}

