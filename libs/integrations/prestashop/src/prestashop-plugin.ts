/**
 * PrestaShop Plugin Descriptor (#593)
 *
 * Framework-neutral `AdapterPlugin` describing the PrestaShop WebService v1
 * integration. Holds the manifest, the side-registrations the host wires
 * into its registries at boot (connection tester, webhook provisioner),
 * and the per-connection `createCapabilityAdapter` factory.
 *
 * Plugin-specific cross-package deps (`PrestashopCustomerProvisioner`,
 * `PrestashopAddressProvisioner`, `CustomerProjectionRepositoryPort`,
 * `IMappingConfigService`, `WebhookSecretProviderPort`,
 * `PrestashopWebhookProvisioningAdapter`) are passed via the factory
 * constructor — they're NOT part of the curated `HostServices` bag, by
 * design (#593 §1 non-goals).
 *
 * Consumed by `PrestashopIntegrationModule.onModuleInit` — the descriptor
 * is built inline at boot from the module's `@Inject`'d fields and then
 * registered against the host registries. See
 * `docs/plans/implementation-plan-adapter-plugin-contract.md` § 3.4 for
 * the canonical recipe.
 *
 * @module libs/integrations/prestashop/src
 */
import type { AdapterPlugin, HostServices } from '@openlinker/plugin-sdk';
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { WebhookSecretProviderPort } from '@openlinker/core/integrations';
import type { CustomerProjectionRepositoryPort } from '@openlinker/core/customers';
import type { IMappingConfigService } from '@openlinker/core/mappings';
import { PrestashopAdapterFactory } from './application/prestashop-adapter.factory';
import { PrestashopConnectionTesterAdapter } from './infrastructure/adapters/prestashop-connection-tester.adapter';
import type { PrestashopCustomerProvisioner } from './infrastructure/provisioners/prestashop-customer-provisioner';
import type { PrestashopAddressProvisioner } from './infrastructure/provisioners/prestashop-address-provisioner';
import type { PrestashopWebhookProvisioningAdapter } from './infrastructure/adapters/prestashop-webhook-provisioning.adapter';

export interface CreatePrestashopPluginDeps {
  readonly customerProvisioner: PrestashopCustomerProvisioner;
  readonly addressProvisioner: PrestashopAddressProvisioner;
  readonly customerProjectionRepository: CustomerProjectionRepositoryPort;
  readonly mappingConfigService: IMappingConfigService;
  readonly webhookSecretProvider: WebhookSecretProviderPort;
  readonly webhookProvisioningAdapter: PrestashopWebhookProvisioningAdapter;
}

export function createPrestashopPlugin(deps: CreatePrestashopPluginDeps): AdapterPlugin {
  return {
    manifest: {
      adapterKey: 'prestashop.webservice.v1',
      platformType: 'prestashop',
      supportedCapabilities: [
        'ProductMaster',
        'InventoryMaster',
        'OrderSource',
        'OrderProcessorManager',
      ],
      displayName: 'PrestaShop WebService v1',
      version: '1.0.0',
      isDefault: true,
    },

    register(host: HostServices): void {
      host.connectionTesterRegistry.register(
        'prestashop.webservice.v1',
        new PrestashopConnectionTesterAdapter(),
      );
      // Webhook provisioner — replaces direct injection of the PS-specific
      // service in `apps/api`'s ConnectionController (#583). The controller
      // resolves provisioners by adapterKey via the registry.
      host.webhookProvisioningRegistry.register(
        'prestashop.webservice.v1',
        deps.webhookProvisioningAdapter,
      );
    },

    async createCapabilityAdapter<T>(
      connection: Connection,
      capability: string,
      host: HostServices,
    ): Promise<T> {
      const factory = new PrestashopAdapterFactory(
        deps.customerProvisioner,
        deps.addressProvisioner,
        deps.customerProjectionRepository,
        deps.mappingConfigService,
        deps.webhookSecretProvider,
      );
      const adapters = await factory.createAdapters(
        connection,
        host.identifierMapping,
        host.credentialsResolver,
      );

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
    },
  };
}
