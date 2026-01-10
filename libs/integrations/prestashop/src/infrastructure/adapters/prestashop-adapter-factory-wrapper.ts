/**
 * PrestaShop Adapter Factory Wrapper
 *
 * Wraps PrestashopAdapterFactory to implement AdapterFactoryPort interface.
 * This allows the PrestaShop factory to be registered with AdapterFactoryResolverService.
 *
 * @module libs/integrations/prestashop/src/infrastructure/adapters
 * @implements {AdapterFactoryPort}
 */
import { AdapterFactoryPort, CredentialsResolverPort, Capability } from '@openlinker/core/integrations';
import { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { PrestashopAdapterFactory } from '../../application/prestashop-adapter.factory';
// Adapters are created by factory, no need to import here

/**
 * PrestaShop Adapter Factory Wrapper
 *
 * Implements AdapterFactoryPort to integrate with AdapterFactoryResolverService.
 */
export class PrestashopAdapterFactoryWrapper implements AdapterFactoryPort {
  private readonly factory = new PrestashopAdapterFactory();

  async createCapabilityAdapter<T>(
    connection: Connection,
    capability: Capability,
    identifierMapping: IdentifierMappingPort,
    credentialsResolver: CredentialsResolverPort,
  ): Promise<T> {
    // Create all adapters
    const adapters = await this.factory.createAdapters(
      connection,
      identifierMapping,
      credentialsResolver,
    );

    // Return the requested capability adapter
    switch (capability) {
      case 'ProductMaster':
        return adapters.productMaster as unknown as T;
      case 'InventoryMaster':
        return adapters.inventoryMaster as unknown as T;
      case 'OrderSource':
        return adapters.orderSource as unknown as T;
      case 'OrderProcessorManager':
        return adapters.orderProcessorManager as unknown as T;
      default:
        throw new Error(
          `PrestaShop adapter does not support capability: ${capability}. ` +
            `Supported capabilities: ProductMaster, InventoryMaster, OrderSource, OrderProcessorManager`,
        );
    }
  }
}

