/**
 * PrestaShop Adapter Factory
 *
 * Creates PrestaShop adapter instances from Connection entities. Validates
 * configuration, resolves credentials, and injects all dependencies.
 *
 * @module libs/integrations/prestashop/src/application
 * @implements {IPrestashopAdapterFactory}
 */
import type {
  IPrestashopAdapterFactory,
  PrestashopAdapters,
} from './interfaces/prestashop-adapter.factory.interface';
import type { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import type {
  CredentialsResolverPort,
  WebhookSecretProviderPort,
} from '@openlinker/core/integrations';
import type { IMappingConfigService } from '@openlinker/core/mappings';
import type {
  InpostPsModuleType,
  PrestashopConnectionConfig,
} from '../domain/types/prestashop-config.types';
import { InpostPsModuleTypeValues } from '../domain/types/prestashop-config.types';
import type { PrestashopCredentials } from '../domain/types/prestashop-credentials.types';
import { PrestashopConfigException } from '../domain/exceptions/prestashop-config.exception';
import { PrestashopWebserviceClient } from '../infrastructure/http/prestashop-webservice.client';
import { PrestashopOpenLinkerModuleClient } from '../infrastructure/http/prestashop-openlinker-module.client';
import { PrestashopProductMapper } from '../infrastructure/mappers/prestashop-product.mapper';
import { PrestashopInventoryMapper } from '../infrastructure/mappers/prestashop-inventory.mapper';
import { PrestashopOrderMapper } from '../infrastructure/mappers/prestashop-order.mapper';
import { PrestashopProductMasterAdapter } from '../infrastructure/adapters/prestashop-product-master.adapter';
import { PrestashopInventoryMasterAdapter } from '../infrastructure/adapters/prestashop-inventory-master.adapter';
import { PrestashopOrderSourceAdapter } from '../infrastructure/adapters/prestashop-order-source.adapter';
import { PrestashopOrderProcessorManagerAdapter } from '../infrastructure/adapters/prestashop-order-processor-manager.adapter';
import { PrestashopProductPublisherAdapter } from '../infrastructure/adapters/product-publisher/prestashop-product-publisher.adapter';
import type { PrestashopCustomerProvisioner } from '../infrastructure/provisioners/prestashop-customer-provisioner';
import { PrestashopAddressProvisioner } from '../infrastructure/provisioners/prestashop-address-provisioner';
import { PrestashopCountryResolver } from '../infrastructure/provisioners/prestashop-country-resolver';
import { PrestashopCurrencyResolver } from '../infrastructure/provisioners/prestashop-currency-resolver';
import { PrestashopPackResolver } from '../infrastructure/provisioners/prestashop-pack.resolver';
import { PrestashopShopCurrencyResolver } from '../infrastructure/provisioners/prestashop-shop-currency.resolver';
import { PrestashopOrderCurrencyResolver } from '../infrastructure/provisioners/prestashop-order-currency.resolver';
import { PrestashopOrderFeedCapabilityCache } from '../infrastructure/provisioners/prestashop-order-feed-capability.cache';
import { PrestashopTaxRateResolver } from '../infrastructure/provisioners/prestashop-tax-rate.resolver';
import { PrestashopAttributeResolver } from '../infrastructure/provisioners/prestashop-attribute.resolver';
import { PrestashopFeatureResolver } from '../infrastructure/provisioners/prestashop-feature.resolver';
import { PrestashopCategoryPathResolver } from '../infrastructure/provisioners/prestashop-category-path.resolver';
import type { CustomerProjectionRepositoryPort } from '@openlinker/core/customers';
import { Logger } from '@openlinker/shared/logging';
import type { FetchLike } from '@openlinker/shared/http';
import type { CachePort } from '@openlinker/shared/cache';

/**
 * PrestaShop Adapter Factory
 *
 * Creates and configures PrestaShop adapter instances.
 */
export class PrestashopAdapterFactory implements IPrestashopAdapterFactory {
  private readonly logger = new Logger(PrestashopAdapterFactory.name);

  // Held on the factory (a process-singleton) so its option-value cache
  // survives across the per-product adapter instances the master sync creates
  // (#1050). A per-adapter cache would never hit.
  private readonly attributeResolver = new PrestashopAttributeResolver();

  // Held on the factory (process-singleton) so their per-connection caches
  // survive across the per-product adapter instances master sync creates (#1096),
  // mirroring `attributeResolver`.
  private readonly featureResolver = new PrestashopFeatureResolver();
  private readonly categoryPathResolver = new PrestashopCategoryPathResolver();

  // Process-singleton (mirrors the resolvers above) so its per-connection cache
  // of the shop-default-currency ISO survives across per-product adapter
  // instances the master sync creates. Resolves the fallback currency when the
  // connection config leaves `currency` unset.
  private readonly shopCurrencyResolver = new PrestashopShopCurrencyResolver();

  // Same placement and reasoning: master inventory sync builds one adapter per
  // product, so the set of pack ids has to be cached above the adapter or the
  // adapter is back to reading `products/{id}` for every simple product just to
  // learn it is not a pack (#2598).
  private readonly packResolver = new PrestashopPackResolver();

  // Process-singleton for the same reason: master sync builds one adapter per
  // product, so a per-adapter tax-rate cache would never hit (#2054). The
  // order-create path keeps its own instance, built inside the customer-
  // provisioning branch - catalogue sync must not depend on that branch being
  // wired.
  private readonly productTaxRateResolver = new PrestashopTaxRateResolver(
    new PrestashopCountryResolver()
  );

  // Same placement and reasoning as `shopCurrencyResolver`, whose shop-default
  // read it falls back to: a process-singleton field so the per-(connection,
  // id_currency) cache of order denominations (#2277) survives across the
  // adapter instances built per capability resolution.
  private readonly orderCurrencyResolver = new PrestashopOrderCurrencyResolver(
    this.shopCurrencyResolver
  );

  // Process-singleton for the same reason as the caches above: it remembers,
  // per connection, whether the shop refuses `date_upd` as an `orders`
  // sort/filter field (#2877), and a per-adapter cache would never hit since
  // the order-source adapter is rebuilt on every capability resolution.
  private readonly orderFeedCapabilityCache = new PrestashopOrderFeedCapabilityCache();

  // Last shop identity seen per connection id, so a repointed connection can be
  // detected. See `dropCachesOnShopIdentityChange` for why this is the
  // invalidation trigger.
  private readonly shopIdentityByConnection = new Map<string, string>();

  constructor(
    private readonly customerProvisioner?: PrestashopCustomerProvisioner,
    private readonly addressProvisioner?: PrestashopAddressProvisioner,
    private readonly customerProjectionRepository?: CustomerProjectionRepositoryPort,
    private readonly mappingConfigService?: IMappingConfigService,
    // Outbound HMAC signer for the OL PS module endpoints (#516). Required
    // when the orderProcessorManager adapter is wired up — we only build a
    // module client when both the secret provider and the customer-side
    // dependencies (`customerProvisioner`, `customerProjectionRepository`)
    // are present.
    private readonly webhookSecretProvider?: WebhookSecretProviderPort
  ) {
    // Validate that if orderProcessorManager is needed, dependencies are provided
    // Note: Dependencies are optional to allow factory creation without customer provisioning
    // The adapter will fail at runtime if dependencies are missing when needed
    // `mappingConfigService` is optional too — when absent the destination adapter
    // skips carrier resolution and falls back to `defaultCarrierId` / OL Dynamic carrier.
  }

  async createAdapters(
    connection: Connection,
    identifierMapping: IdentifierMappingPort,
    credentialsResolver: CredentialsResolverPort,
    fetchImpl: FetchLike,
    cache?: CachePort
  ): Promise<PrestashopAdapters> {
    this.logger.debug(`Creating PrestaShop adapters for connection: ${connection.id}`);

    // Validate and parse configuration
    const config = this.validateAndParseConfig(connection.config);

    this.dropCachesOnShopIdentityChange(connection.id, config);

    // Resolve credentials
    const credentials = await credentialsResolver.get<PrestashopCredentials>(
      connection.credentialsRef
    );

    // Create HTTP client — connection-bound transport (#1810) threaded
    // through every client this factory constructs below.
    const httpClient = new PrestashopWebserviceClient(config.baseUrl, credentials, config, {
      fetchImpl,
    });

    // Resolve the product currency: an explicit connection-config `currency`
    // always wins; otherwise fall back to the PrestaShop shop default (cached
    // per connection). Resolution is best-effort — on any failure the currency
    // stays unset and the mapper emits `currency: null` (today's behaviour).
    const resolvedCurrency =
      config.currency ??
      (await this.shopCurrencyResolver.resolveDefaultCurrencyIso(connection.id, httpClient)) ??
      undefined;

    // Create mappers. `storefrontBaseUrl` falls back to the webservice `baseUrl`
    // when unset — works for the common case where webservice and storefront
    // share a host. Operators override it via connection config when they differ.
    const productMapper = new PrestashopProductMapper({
      storefrontBaseUrl: config.storefrontBaseUrl ?? config.baseUrl,
      currency: resolvedCurrency,
    });
    const inventoryMapper = new PrestashopInventoryMapper();
    const orderMapper = new PrestashopOrderMapper();

    // Create adapters
    const productMaster = new PrestashopProductMasterAdapter(
      httpClient,
      identifierMapping,
      productMapper,
      connection,
      this.attributeResolver,
      this.featureResolver,
      this.categoryPathResolver,
      // #2054: the product master reads the shop's tax rate through the same
      // resolver the order-create path uses, so the two cannot disagree about
      // one shop. Its own instance (and so its own 5-minute cache) rather than
      // the order branch's, because that one is built only when customer
      // provisioning is wired and the catalogue sync must not depend on that.
      this.productTaxRateResolver
    );

    const inventoryMaster = new PrestashopInventoryMasterAdapter(
      httpClient,
      identifierMapping,
      inventoryMapper,
      connection,
      this.packResolver,
      // #2369: backs the adjustInventory idempotency window. Undefined is a
      // supported state — the adapter then reports 'unsupported' rather than
      // claiming a dedupe it cannot perform.
      cache
    );

    const orderSource = new PrestashopOrderSourceAdapter(
      httpClient,
      orderMapper,
      connection,
      this.orderCurrencyResolver,
      this.orderFeedCapabilityCache
    );

    // Create orderProcessorManager only if customer provisioning dependencies
    // and the outbound webhook-secret provider (#516) are provided.
    let orderProcessorManager: PrestashopOrderProcessorManagerAdapter | undefined;
    if (
      this.customerProvisioner &&
      this.customerProjectionRepository &&
      this.webhookSecretProvider
    ) {
      // Create provisioners (if not provided, create new instances)
      const countryResolver = new PrestashopCountryResolver();
      const currencyResolver = new PrestashopCurrencyResolver();
      const taxRateResolver = new PrestashopTaxRateResolver(countryResolver);
      const addressProvisioner =
        this.addressProvisioner || new PrestashopAddressProvisioner(null, countryResolver);

      // Per-connection HMAC client for the OL PS module's storefront
      // endpoints. Same secret bytes as the inbound webhook receiver — the
      // shared `WebhookSecretProviderPort` is used in both directions
      // (outbound signing here, inbound verification in the webhook
      // controller). Storefront base URL falls back to the webservice URL
      // when unset, matching the mappers.
      const openlinkerModuleClient = new PrestashopOpenLinkerModuleClient(
        connection.id,
        config.storefrontBaseUrl ?? config.baseUrl,
        this.webhookSecretProvider,
        fetchImpl
      );

      orderProcessorManager = new PrestashopOrderProcessorManagerAdapter(
        httpClient,
        identifierMapping,
        orderMapper,
        connection,
        this.customerProvisioner,
        addressProvisioner,
        currencyResolver,
        this.customerProjectionRepository,
        openlinkerModuleClient,
        taxRateResolver,
        this.mappingConfigService
      );
    } else {
      this.logger.warn(
        `OrderProcessorManager adapter not created for connection ${connection.id}: ` +
          `customerProvisioner, customerProjectionRepository, or webhookSecretProvider not provided. ` +
          `This adapter is required for order processing.`
      );
    }

    // Deliberately NOT `fetchImpl` (the connection-bound, PrestaShop-rate-
    // limited transport): PrestashopProductPublisherAdapter's third
    // constructor argument backs only its uploadImages() source-image
    // fetch, which targets an arbitrary external host (master platform CDN,
    // S3, ...), never PrestaShop itself. Passing the PrestaShop-scoped
    // limiter here would (a) spend this connection's PrestaShop API budget
    // on unrelated image traffic and (b) let a 429/503 from that unrelated
    // host push back the PrestaShop limiter's own pacing via
    // `noteRetryAfter`. Leaving it `undefined` falls back to
    // `globalThis.fetch`, unbound.
    const productPublisher = new PrestashopProductPublisherAdapter(httpClient, connection);

    this.logger.log(`PrestaShop adapters created successfully for connection: ${connection.id}`);

    return {
      productMaster,
      inventoryMaster,
      orderSource,
      orderProcessorManager,
      productPublisher,
    };
  }

  /**
   * Drop this connection's resolver caches when the shop behind it changed.
   *
   * Every cache on this factory is keyed by connection id and, since #2592,
   * lives for the process. The connection id does not change when an operator
   * repoints the connection at a different shop, or moves it to another store
   * of a multi-store install, so without this the previous shop's default
   * currency, feature and option names, category paths and tax rates would keep
   * being served under the same key until the TTL expired - a day for most of
   * them.
   *
   * The trigger is the shop identity carried in the connection config, because
   * that is the only signal a plugin can see for itself. There is no host seam
   * that notifies a plugin when `ConnectionService.update` runs: the eight
   * registries a plugin self-registers against cover connection testing,
   * webhook provisioning, config and credentials shape validation, retry and
   * auth-failure classification, scheduler tasks and email normalisation, and
   * none of them is a change feed. Adding one would be a core contract change
   * for a plugin-local caching concern. Every adapter build already passes
   * through `createAdapters`, so checking here costs one map lookup and closes
   * the reconfiguration window to the next job.
   *
   * What it does not close: an operator changing the shop's own default
   * currency in the PrestaShop back office leaves this config untouched, so
   * that stays a TTL question. `PrestashopShopCurrencyResolver` holds the
   * shortest TTL of the shop-level caches for exactly that reason.
   */
  private dropCachesOnShopIdentityChange(
    connectionId: string,
    config: PrestashopConnectionConfig
  ): void {
    const identity = `${config.baseUrl}|${config.shopId ?? ''}|${config.langId ?? ''}`;
    const previous = this.shopIdentityByConnection.get(connectionId);
    this.shopIdentityByConnection.set(connectionId, identity);

    if (previous === undefined || previous === identity) {
      return;
    }

    this.logger.log(
      `PrestaShop connection ${connectionId} now points at a different shop; ` +
        `dropping its cached shop-level facts`
    );
    this.attributeResolver.clearCache(connectionId);
    this.featureResolver.clearCache(connectionId);
    this.categoryPathResolver.clearCache(connectionId);
    this.shopCurrencyResolver.clearCache(connectionId);
    this.orderCurrencyResolver.clearCache(connectionId);
    this.productTaxRateResolver.clearCache(connectionId);
    // Pack ids are shop-scoped product ids, so the previous shop's set would
    // classify unrelated products of the new shop as packs.
    this.packResolver.clearCache(connectionId);
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
        config.baseUrl
      );
    }

    // Validate URL format
    try {
      new URL(config.baseUrl);
    } catch (error) {
      throw new PrestashopConfigException(
        `Invalid baseUrl format: ${config.baseUrl}`,
        'baseUrl',
        config.baseUrl
      );
    }

    // Validate storefrontBaseUrl (optional — falls back to baseUrl at use site)
    if (config.storefrontBaseUrl !== undefined) {
      if (typeof config.storefrontBaseUrl !== 'string') {
        throw new PrestashopConfigException(
          'storefrontBaseUrl must be a string',
          'storefrontBaseUrl',
          config.storefrontBaseUrl
        );
      }
      try {
        new URL(config.storefrontBaseUrl);
      } catch (error) {
        throw new PrestashopConfigException(
          `Invalid storefrontBaseUrl format: ${config.storefrontBaseUrl}`,
          'storefrontBaseUrl',
          config.storefrontBaseUrl
        );
      }
    }

    // Validate shopId (if provided)
    if (config.shopId !== undefined) {
      const shopId =
        typeof config.shopId === 'number' ? config.shopId : parseInt(String(config.shopId), 10);
      if (isNaN(shopId) || shopId < 1) {
        throw new PrestashopConfigException(
          'shopId must be a positive integer',
          'shopId',
          config.shopId
        );
      }
      config.shopId = shopId;
    }

    // Validate langId (if provided)
    if (config.langId !== undefined) {
      const langId =
        typeof config.langId === 'number' ? config.langId : parseInt(String(config.langId), 10);
      if (isNaN(langId) || langId < 1) {
        throw new PrestashopConfigException(
          'langId must be a positive integer',
          'langId',
          config.langId
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
          config.defaultCarrierId
        );
      }
      config.defaultCarrierId = defaultCarrierId;
    }

    // Validate timeoutMs (if provided)
    if (config.timeoutMs !== undefined) {
      const timeoutMs =
        typeof config.timeoutMs === 'number'
          ? config.timeoutMs
          : parseInt(String(config.timeoutMs), 10);
      if (isNaN(timeoutMs) || timeoutMs < 1000) {
        throw new PrestashopConfigException(
          'timeoutMs must be at least 1000ms',
          'timeoutMs',
          config.timeoutMs
        );
      }
      config.timeoutMs = timeoutMs;
    }

    // Validate pageSize (if provided)
    if (config.pageSize !== undefined) {
      const pageSize =
        typeof config.pageSize === 'number'
          ? config.pageSize
          : parseInt(String(config.pageSize), 10);
      if (isNaN(pageSize) || pageSize < 1 || pageSize > 1000) {
        throw new PrestashopConfigException(
          'pageSize must be between 1 and 1000',
          'pageSize',
          config.pageSize
        );
      }
      config.pageSize = pageSize;
    }

    // Validate responseFormat (if provided)
    if (config.responseFormat !== undefined) {
      const validFormats = ['auto', 'json', 'xml'];
      if (
        typeof config.responseFormat !== 'string' ||
        !validFormats.includes(config.responseFormat)
      ) {
        throw new PrestashopConfigException(
          `responseFormat must be one of: ${validFormats.join(', ')}`,
          'responseFormat',
          config.responseFormat
        );
      }
    }

    // Validate inpostPsModuleType (if provided)
    if (config.inpostPsModuleType !== undefined) {
      if (
        typeof config.inpostPsModuleType !== 'string' ||
        !(InpostPsModuleTypeValues as readonly string[]).includes(config.inpostPsModuleType)
      ) {
        throw new PrestashopConfigException(
          `inpostPsModuleType must be one of: ${InpostPsModuleTypeValues.join(', ')}`,
          'inpostPsModuleType',
          config.inpostPsModuleType
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
      inpostPsModuleType: config.inpostPsModuleType as InpostPsModuleType | undefined,
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
      throw new PrestashopConfigException('currency must be a string', 'currency', raw);
    }
    const upper = raw.toUpperCase();
    if (!/^[A-Z]{3}$/.test(upper)) {
      throw new PrestashopConfigException(
        'currency must be a 3-letter ISO 4217 code (e.g., PLN, EUR)',
        'currency',
        raw
      );
    }
    return upper;
  }
}
