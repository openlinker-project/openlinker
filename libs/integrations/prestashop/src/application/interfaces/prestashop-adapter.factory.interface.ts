/**
 * PrestaShop Adapter Factory Interface
 *
 * Defines the contract for creating PrestaShop adapter instances from Connection
 * entities. The factory validates configuration, resolves credentials, and creates
 * adapter instances with all dependencies injected.
 *
 * @module libs/integrations/prestashop/src/application/interfaces
 */
import { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { CredentialsResolverPort } from '@openlinker/core/integrations';
// eslint-disable-next-line no-restricted-imports
import { PrestashopProductMasterAdapter } from '../../infrastructure/adapters/prestashop-product-master.adapter';
// eslint-disable-next-line no-restricted-imports
import { PrestashopInventoryMasterAdapter } from '../../infrastructure/adapters/prestashop-inventory-master.adapter';
// eslint-disable-next-line no-restricted-imports
import { PrestashopOrderSourceAdapter } from '../../infrastructure/adapters/prestashop-order-source.adapter';

/**
 * PrestaShop adapter instances
 *
 * Container for all three capability adapters created from a Connection.
 */
export interface PrestashopAdapters {
  productMaster: PrestashopProductMasterAdapter;
  inventoryMaster: PrestashopInventoryMasterAdapter;
  orderSource: PrestashopOrderSourceAdapter;
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
   * all three capability adapters (ProductMaster, InventoryMaster, OrderSource).
   *
   * @param connection - Connection entity
   * @param identifierMapping - Identifier mapping service
   * @param credentialsResolver - Credentials resolver service
   * @returns All three adapter instances
   * @throws PrestashopConfigException if configuration is invalid
   * @throws Error if credentials cannot be resolved
   */
  createAdapters(
    connection: Connection,
    identifierMapping: IdentifierMappingPort,
    credentialsResolver: CredentialsResolverPort,
  ): Promise<PrestashopAdapters>;
}

