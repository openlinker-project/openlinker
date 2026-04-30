/**
 * PrestaShop Adapter Factory
 *
 * Creates PrestaShop adapter instances from Connection entities. Validates
 * configuration, resolves credentials, and injects all dependencies.
 *
 * @module libs/integrations/prestashop/src/application
 * @implements {IPrestashopAdapterFactory}
 */
import { IPrestashopAdapterFactory, PrestashopAdapters } from './interfaces/prestashop-adapter.factory.interface';
import { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { CredentialsResolverPort } from '@openlinker/core/integrations';
import { IMappingConfigService } from '@openlinker/core/mappings';
import { PrestashopConnectionConfig } from '../domain/types/prestashop-config.types';
import { PrestashopCredentials } from '../domain/types/prestashop-credentials.types';
import { PrestashopConfigException } from '../domain/exceptions/prestashop-config.exception';
import { PrestashopWebserviceClient } from '../infrastructure/http/prestashop-webservice.client';
import { PrestashopProductMapper } from '../infrastructure/mappers/prestashop-product.mapper';
import { PrestashopInventoryMapper } from '../infrastructure/mappers/prestashop-inventory.mapper';
import { PrestashopOrderMapper } from '../infrastructure/mappers/prestashop-order.mapper';
import { PrestashopProductMasterAdapter } from '../infrastructure/adapters/prestashop-product-master.adapter';
import { PrestashopInventoryMasterAdapter } from '../infrastructure/adapters/prestashop-inventory-master.adapter';
import { PrestashopOrderSourceAdapter } from '../infrastructure/adapters/prestashop-order-source.adapter';
import { PrestashopOrderProcessorManagerAdapter } from '../infrastructure/adapters/prestashop-order-processor-manager.adapter';
import { PrestashopCustomerProvisioner } from '../infrastructure/provisioners/prestashop-customer-provisioner';
import { PrestashopAddressProvisioner } from '../infrastructure/provisioners/prestashop-address-provisioner';
import { PrestashopCountryResolver } from '../infrastructure/provisioners/prestashop-country-resolver';
import { PrestashopCurrencyResolver } from '../infrastructure/provisioners/prestashop-currency-resolver';
import { CustomerProjectionRepositoryPort } from '@openlinker/core/customers';
import { Logger } from '@openlinker/shared/logging';

/**
 * PrestaShop Adapter Factory
 *
 * Creates and configures PrestaShop adapter instances.
 */
export class PrestashopAdapterFactory implements IPrestashopAdapterFactory {
  private readonly logger = new Logger(PrestashopAdapterFactory.name);

  constructor(
    private readonly customerProvisioner?: PrestashopCustomerProvisioner,
    private readonly addressProvisioner?: PrestashopAddressProvisioner,
    private readonly customerProjectionRepository?: CustomerProjectionRepositoryPort,
    private readonly mappingConfigService?: IMappingConfigService,
  ) {
    // Validate that if orderProcessorManager is needed, dependencies are provided
    // Note: Dependencies are optional to allow factory creation without customer provisioning
    // The adapter will fail at runtime if dependencies are missing when needed
    // `mappingConfigService` is optional too — when absent the destination adapter
    // skips carrier resolution and falls back to `defaultCarrierId` / `1`.
  }

  async createAdapters(
    connection: Connection,
    identifierMapping: IdentifierMappingPort,
    credentialsResolver: CredentialsResolverPort,
  ): Promise<PrestashopAdapters> {
    this.logger.debug(`Creating PrestaShop adapters for connection: ${connection.id}`);

    // Validate and parse configuration
    const config = this.validateAndParseConfig(connection.config);

    // Resolve credentials
    const credentials = await credentialsResolver.get<PrestashopCredentials>(connection.credentialsRef);

    // Create HTTP client
    const httpClient = new PrestashopWebserviceClient(
      config.baseUrl,
      credentials,
      config,
    );

    // Create mappers. `storefrontBaseUrl` falls back to the webservice `baseUrl`
    // when unset — works for the common case where webservice and storefront
    // share a host. Operators override it via connection config when they differ.
    const productMapper = new PrestashopProductMapper({
      storefrontBaseUrl: config.storefrontBaseUrl ?? config.baseUrl,
      currency: config.currency,
    });
    const inventoryMapper = new PrestashopInventoryMapper();
    const orderMapper = new PrestashopOrderMapper();

    // Create adapters
    const productMaster = new PrestashopProductMasterAdapter(
      httpClient,
      identifierMapping,
      productMapper,
      connection,
    );

    const inventoryMaster = new PrestashopInventoryMasterAdapter(
      httpClient,
      identifierMapping,
      inventoryMapper,
      connection,
    );

    const orderSource = new PrestashopOrderSourceAdapter(
      httpClient,
      orderMapper,
      connection,
    );

    // Create orderProcessorManager only if customer provisioning dependencies are provided
    let orderProcessorManager: PrestashopOrderProcessorManagerAdapter | undefined;
    if (this.customerProvisioner && this.customerProjectionRepository) {
      // Create provisioners (if not provided, create new instances)
      const countryResolver = new PrestashopCountryResolver();
      const currencyResolver = new PrestashopCurrencyResolver();
      const addressProvisioner =
        this.addressProvisioner || new PrestashopAddressProvisioner(null, countryResolver);

      orderProcessorManager = new PrestashopOrderProcessorManagerAdapter(
        httpClient,
        identifierMapping,
        orderMapper,
        connection,
        this.customerProvisioner,
        addressProvisioner,
        currencyResolver,
        this.customerProjectionRepository,
        this.mappingConfigService,
      );
    } else {
      this.logger.warn(
        `OrderProcessorManager adapter not created for connection ${connection.id}: ` +
          `customerProvisioner or customerProjectionRepository not provided. ` +
          `This adapter is required for order processing.`,
      );
    }

    this.logger.log(`PrestaShop adapters created successfully for connection: ${connection.id}`);

    return {
      productMaster,
      inventoryMaster,
      orderSource,
      orderProcessorManager,
    };
  }

  /**
   * Validate and parse connection configuration
   *
   * @param config - Raw connection config
   * @returns Validated PrestaShop configuration
   * @throws PrestashopConfigException if configuration is invalid
   */
  private validateAndParseConfig(config: Record<string, unknown>): PrestashopConnectionConfig {
    // Validate baseUrl
    if (!config.baseUrl || typeof config.baseUrl !== 'string') {
      throw new PrestashopConfigException(
        'baseUrl is required and must be a string',
        'baseUrl',
        config.baseUrl,
      );
    }

    // Validate URL format
    try {
      new URL(config.baseUrl);
    } catch (error) {
      throw new PrestashopConfigException(
        `Invalid baseUrl format: ${config.baseUrl}`,
        'baseUrl',
        config.baseUrl,
      );
    }

    // Validate storefrontBaseUrl (optional — falls back to baseUrl at use site)
    if (config.storefrontBaseUrl !== undefined) {
      if (typeof config.storefrontBaseUrl !== 'string') {
        throw new PrestashopConfigException(
          'storefrontBaseUrl must be a string',
          'storefrontBaseUrl',
          config.storefrontBaseUrl,
        );
      }
      try {
        new URL(config.storefrontBaseUrl);
      } catch (error) {
        throw new PrestashopConfigException(
          `Invalid storefrontBaseUrl format: ${config.storefrontBaseUrl}`,
          'storefrontBaseUrl',
          config.storefrontBaseUrl,
        );
      }
    }

    // Validate shopId (if provided)
    if (config.shopId !== undefined) {
      const shopId = typeof config.shopId === 'number' ? config.shopId : parseInt(String(config.shopId), 10);
      if (isNaN(shopId) || shopId < 1) {
        throw new PrestashopConfigException(
          'shopId must be a positive integer',
          'shopId',
          config.shopId,
        );
      }
      config.shopId = shopId;
    }

    // Validate langId (if provided)
    if (config.langId !== undefined) {
      const langId = typeof config.langId === 'number' ? config.langId : parseInt(String(config.langId), 10);
      if (isNaN(langId) || langId < 1) {
        throw new PrestashopConfigException(
          'langId must be a positive integer',
          'langId',
          config.langId,
        );
      }
      config.langId = langId;
    }

    // Validate defaultCarrierId (if provided)
    if (config.defaultCarrierId !== undefined) {
      const defaultCarrierId =
        typeof config.defaultCarrierId === 'number'
          ? config.defaultCarrierId
          : parseInt(String(config.defaultCarrierId), 10);
      if (isNaN(defaultCarrierId) || defaultCarrierId < 1) {
        throw new PrestashopConfigException(
          'defaultCarrierId must be a positive integer',
          'defaultCarrierId',
          config.defaultCarrierId,
        );
      }
      config.defaultCarrierId = defaultCarrierId;
    }

    // Validate timeoutMs (if provided)
    if (config.timeoutMs !== undefined) {
      const timeoutMs = typeof config.timeoutMs === 'number' ? config.timeoutMs : parseInt(String(config.timeoutMs), 10);
      if (isNaN(timeoutMs) || timeoutMs < 1000) {
        throw new PrestashopConfigException(
          'timeoutMs must be at least 1000ms',
          'timeoutMs',
          config.timeoutMs,
        );
      }
      config.timeoutMs = timeoutMs;
    }

    // Validate pageSize (if provided)
    if (config.pageSize !== undefined) {
      const pageSize = typeof config.pageSize === 'number' ? config.pageSize : parseInt(String(config.pageSize), 10);
      if (isNaN(pageSize) || pageSize < 1 || pageSize > 1000) {
        throw new PrestashopConfigException(
          'pageSize must be between 1 and 1000',
          'pageSize',
          config.pageSize,
        );
      }
      config.pageSize = pageSize;
    }

    // Validate responseFormat (if provided)
    if (config.responseFormat !== undefined) {
      const validFormats = ['auto', 'json', 'xml'];
      if (typeof config.responseFormat !== 'string' || !validFormats.includes(config.responseFormat)) {
        throw new PrestashopConfigException(
          `responseFormat must be one of: ${validFormats.join(', ')}`,
          'responseFormat',
          config.responseFormat,
        );
      }
    }

    const currency = this.parseOptionalIsoCurrency(config.currency);

    // Build validated config with defaults
    const validatedConfig: PrestashopConnectionConfig = {
      baseUrl: config.baseUrl,
      // No cast needed: TypeScript narrows `config.storefrontBaseUrl` to
      // `string | undefined` via the preceding `typeof` guard + throw branch.
      // `@typescript-eslint/no-unnecessary-type-assertion` flags the redundant
      // assertion that symmetry with sibling fields would otherwise suggest.
      storefrontBaseUrl: config.storefrontBaseUrl,
      shopId: config.shopId as number | undefined,
      langId: (config.langId as number | undefined) ?? 1,
      timeoutMs: (config.timeoutMs as number | undefined) ?? 30000,
      pageSize: (config.pageSize as number | undefined) ?? 100,
      responseFormat: (config.responseFormat as 'auto' | 'json' | 'xml' | undefined) ?? 'auto',
      currency,
      defaultCarrierId: config.defaultCarrierId as number | undefined,
    };

    return validatedConfig;
  }

  /**
   * Parse and validate an optional ISO 4217 currency code.
   *
   * Accepts undefined/null/empty-string as "not set" (returns undefined).
   * Normalises case (e.g. 'pln' -> 'PLN') and enforces the 3-letter alpha
   * format. Does not validate membership in the real ISO 4217 registry — the
   * mapper only propagates the value; downstream persistence accepts any short
   * string and the FE renders an unknown code as the muted fallback glyph.
   */
  private parseOptionalIsoCurrency(raw: unknown): string | undefined {
    if (raw === undefined || raw === null || raw === '') {
      return undefined;
    }
    if (typeof raw !== 'string') {
      throw new PrestashopConfigException(
        'currency must be a string',
        'currency',
        raw,
      );
    }
    const upper = raw.toUpperCase();
    if (!/^[A-Z]{3}$/.test(upper)) {
      throw new PrestashopConfigException(
        'currency must be a 3-letter ISO 4217 code (e.g., PLN, EUR)',
        'currency',
        raw,
      );
    }
    return upper;
  }
}

