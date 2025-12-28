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
import { Logger } from '@openlinker/shared/logging';

/**
 * PrestaShop Adapter Factory
 *
 * Creates and configures PrestaShop adapter instances.
 */
export class PrestashopAdapterFactory implements IPrestashopAdapterFactory {
  private readonly logger = new Logger(PrestashopAdapterFactory.name);

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

    // Create mappers
    const productMapper = new PrestashopProductMapper();
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
      identifierMapping,
      orderMapper,
      connection,
    );

    this.logger.log(`PrestaShop adapters created successfully for connection: ${connection.id}`);

    return {
      productMaster,
      inventoryMaster,
      orderSource,
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

    // Build validated config with defaults
    const validatedConfig: PrestashopConnectionConfig = {
      baseUrl: config.baseUrl,
      shopId: config.shopId as number | undefined,
      langId: (config.langId as number | undefined) ?? 1,
      timeoutMs: (config.timeoutMs as number | undefined) ?? 30000,
      pageSize: (config.pageSize as number | undefined) ?? 100,
      responseFormat: (config.responseFormat as 'auto' | 'json' | 'xml' | undefined) ?? 'auto',
    };

    return validatedConfig;
  }
}

