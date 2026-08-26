/**
 * PrestaShop Adapter Factory Interface
 *
 * Defines the contract for creating PrestaShop adapter instances from Connection
 * entities. The factory validates configuration, resolves credentials, and creates
 * adapter instances with all dependencies injected.
 *
 * @module libs/integrations/prestashop/src/application/interfaces
 */
import type { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import type { FetchLike } from '@openlinker/shared/http';
import type { CachePort } from '@openlinker/shared/cache';
// eslint-disable-next-line no-restricted-imports -- local relative import is intentional here; barrel path would create a runtime cycle
import type { PrestashopProductMasterAdapter } from '../../infrastructure/adapters/prestashop-product-master.adapter';
// eslint-disable-next-line no-restricted-imports -- local relative import is intentional here; barrel path would create a runtime cycle
import type { PrestashopInventoryMasterAdapter } from '../../infrastructure/adapters/prestashop-inventory-master.adapter';
// eslint-disable-next-line no-restricted-imports -- local relative import is intentional here; barrel path would create a runtime cycle
import type { PrestashopOrderSourceAdapter } from '../../infrastructure/adapters/prestashop-order-source.adapter';
// eslint-disable-next-line no-restricted-imports -- local relative import is intentional here; barrel path would create a runtime cycle
import type { PrestashopOrderProcessorManagerAdapter } from '../../infrastructure/adapters/prestashop-order-processor-manager.adapter';
// eslint-disable-next-line no-restricted-imports -- local relative import is intentional here; barrel path would create a runtime cycle
import type { PrestashopProductPublisherAdapter } from '../../infrastructure/adapters/product-publisher/prestashop-product-publisher.adapter';

/**
 * PrestaShop adapter instances
 *
 * Container for all capability adapters created from a Connection.
 * orderProcessorManager is optional and only created when customer provisioning
 * dependencies are provided.
 */
export interface PrestashopAdapters {
  productMaster: PrestashopProductMasterAdapter;
  inventoryMaster: PrestashopInventoryMasterAdapter;
  orderSource: PrestashopOrderSourceAdapter;
  orderProcessorManager?: PrestashopOrderProcessorManagerAdapter;
  productPublisher: PrestashopProductPublisherAdapter;
}

/**
 * PrestaShop Adapter Factory Interface
 *
 * Factory for creating PrestaShop adapter instances from Connection entities.
 */
export interface IPrestashopAdapterFactory {
  /**
   * Create all PrestaShop adapters for a connection
   *
   * Validates connection configuration and credentials, then creates
   * all capability adapters (ProductMaster, InventoryMaster, OrderSource, OrderProcessorManager, ProductPublisher).
   *
   * @param connection - Connection entity
   * @param identifierMapping - Identifier mapping service
   * @param credentialsResolver - Credentials resolver service
   * @param fetchImpl - Connection-bound outbound transport (#1810) — every
   *   client this factory constructs is wired with it, so all outbound HTTP
   *   for this connection is paced/capped per its `config.rateLimit`.
   * @param cache - Optional shared cache (#2369), backing the inventory
   *   adapter's `adjustInventory` idempotency window. Optional and TRAILING:
   *   `HostServices.cache` is itself optional, and this interface is exported
   *   from the package barrel, so widening it this way keeps every existing
   *   caller and any out-of-tree implementer source-compatible. Absent, the
   *   adapter applies each adjustment and reports `idempotency: 'unsupported'`
   *   rather than pretending to dedupe.
   * @returns All adapter instances
   * @throws PrestashopConfigException if configuration is invalid
   * @throws Error if credentials cannot be resolved
   */
  createAdapters(
    connection: Connection,
    identifierMapping: IdentifierMappingPort,
    credentialsResolver: CredentialsResolverPort,
    fetchImpl: FetchLike,
    cache?: CachePort
  ): Promise<PrestashopAdapters>;
}
