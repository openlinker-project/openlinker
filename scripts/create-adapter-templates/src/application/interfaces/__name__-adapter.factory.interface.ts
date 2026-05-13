/**
 * __Name__ Adapter Factory Interface
 *
 * Public contract for the per-connection __Name__ adapter factory.
 * Implementations live under `application/__name__-adapter.factory.ts`.
 *
 * Co-locates the factory's input contract (`I__Name__AdapterFactory`)
 * with its output shape (`__Name__Adapters`) — matches the PrestaShop
 * reference adapter at
 * `libs/integrations/prestashop/src/application/interfaces/prestashop-adapter.factory.interface.ts`.
 *
 * @module libs/integrations/__name__/src/application/interfaces
 */
import type { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';

/**
 * Empty adapter bundle. Widen this shape as you add capabilities — one
 * field per capability adapter, keyed by lowercase camel-cased
 * capability name (e.g. `productMaster: __Name__ProductMasterAdapter`).
 */
export interface __Name__Adapters {
  // productMaster?: __Name__ProductMasterAdapter;
  // inventoryMaster?: __Name__InventoryMasterAdapter;
  // orderSource?: __Name__OrderSourceAdapter;
}

export interface I__Name__AdapterFactory {
  createAdapters(
    connection: Connection,
    identifierMapping: IdentifierMappingPort,
    credentialsResolver: CredentialsResolverPort,
  ): Promise<__Name__Adapters>;
}
