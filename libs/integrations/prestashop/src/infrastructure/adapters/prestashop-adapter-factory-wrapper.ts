/**
 * PrestaShop Adapter Factory Wrapper
 *
 * Wraps PrestashopAdapterFactory to implement AdapterFactoryPort interface.
 * This allows the PrestaShop factory to be registered with AdapterFactoryResolverService.
 * Injects NestJS dependencies (provisioner, customer projection repository) for customer provisioning.
 *
 * @module libs/integrations/prestashop/src/infrastructure/adapters
 * @implements {AdapterFactoryPort}
 */
import {
  AdapterFactoryPort,
  CredentialsResolverPort,
  WebhookSecretProviderPort,
} from '@openlinker/core/integrations';
import { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { IMappingConfigService } from '@openlinker/core/mappings';
import { PrestashopAdapterFactory } from '../../application/prestashop-adapter.factory';
import { PrestashopCustomerProvisioner } from '../provisioners/prestashop-customer-provisioner';
import { PrestashopAddressProvisioner } from '../provisioners/prestashop-address-provisioner';
import { CustomerProjectionRepositoryPort } from '@openlinker/core/customers';
// Adapters are created by factory, no need to import here

/**
 * PrestaShop Adapter Factory Wrapper
 *
 * Implements AdapterFactoryPort to integrate with AdapterFactoryResolverService.
 * Accepts optional dependencies for customer provisioning (injected via NestJS DI).
 */
export class PrestashopAdapterFactoryWrapper implements AdapterFactoryPort {
  private readonly factory: PrestashopAdapterFactory;

  constructor(
    private readonly _customerProvisioner?: PrestashopCustomerProvisioner,
    private readonly _addressProvisioner?: PrestashopAddressProvisioner,
    private readonly _customerProjectionRepository?: CustomerProjectionRepositoryPort,
    private readonly _mappingConfigService?: IMappingConfigService,
    private readonly _webhookSecretProvider?: WebhookSecretProviderPort,
  ) {
    this.factory = new PrestashopAdapterFactory(
      this._customerProvisioner,
      this._addressProvisioner,
      this._customerProjectionRepository,
      this._mappingConfigService,
      this._webhookSecretProvider,
    );
  }

  async createCapabilityAdapter<T>(
    connection: Connection,
    capability: string,
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
        if (!adapters.orderProcessorManager) {
          throw new Error(
            'OrderProcessorManager adapter is not available. ' +
              'Customer provisioner and customer projection repository are required for order processing.',
          );
        }
        return adapters.orderProcessorManager as unknown as T;
      default:
        throw new Error(
          `PrestaShop adapter does not support capability: ${capability}. ` +
            `Supported capabilities: ProductMaster, InventoryMaster, OrderSource, OrderProcessorManager`,
        );
    }
  }
}

