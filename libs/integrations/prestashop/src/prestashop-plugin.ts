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
import type { ConfigService } from '@nestjs/config';
import { dispatchCapability, type AdapterPlugin, type HostServices } from '@openlinker/plugin-sdk';
import type { AdapterMetadata } from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { WebhookSecretProviderPort } from '@openlinker/core/integrations';
import type { CustomerProjectionRepositoryPort } from '@openlinker/core/customers';
import type { IMappingConfigService } from '@openlinker/core/mappings';
import { PrestashopAdapterFactory } from './application/prestashop-adapter.factory';
import { PrestashopConnectionTesterAdapter } from './infrastructure/adapters/prestashop-connection-tester.adapter';
import { PrestashopConnectionConfigShapeValidatorAdapter } from './infrastructure/adapters/prestashop-connection-config-shape-validator.adapter';
import { PrestashopConnectionCredentialsShapeValidatorAdapter } from './infrastructure/adapters/prestashop-connection-credentials-shape-validator.adapter';
import { buildPrestashopSchedulerTasks } from './infrastructure/scheduler/prestashop-scheduler-tasks';
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
  /**
   * NestJS ConfigService — used to build scheduler tasks
   * (`buildPrestashopSchedulerTasks`, #834). When absent (unit-test
   * bootstraps), the plugin skips scheduler-task registration.
   */
  readonly configService?: ConfigService;
}

/**
 * Static plugin manifest (#575).
 *
 * Exported as a top-level `const` so consumers can read manifest fields
 * without instantiating the full plugin. The runtime path
 * (`createPrestashopPlugin(deps).manifest`) returns this same reference, so
 * there's no drift between static and runtime views.
 */
export const prestashopAdapterManifest: AdapterMetadata = {
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
};

/**
 * Short brand label used as the `pluginName` argument when this plugin's
 * adapters raise domain exceptions (`InvalidConnectionConfigException`,
 * `InvalidCredentialsShapeException`). `manifest.displayName` reads as
 * "PrestaShop WebService v1" which is too long for an error prefix; this
 * constant keeps the user-facing label co-located with the manifest so a
 * rebrand touches one line, not every adapter.
 */
const PRESTASHOP_BRAND = 'PrestaShop';

export function createPrestashopPlugin(deps: CreatePrestashopPluginDeps): AdapterPlugin {
  return {
    manifest: prestashopAdapterManifest,

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
      host.connectionConfigShapeValidatorRegistry.register(
        'prestashop.webservice.v1',
        new PrestashopConnectionConfigShapeValidatorAdapter(PRESTASHOP_BRAND),
      );
      host.connectionCredentialsShapeValidatorRegistry.register(
        'prestashop.webservice.v1',
        new PrestashopConnectionCredentialsShapeValidatorAdapter(PRESTASHOP_BRAND),
      );
      if (deps.configService) {
        for (const task of buildPrestashopSchedulerTasks(deps.configService)) {
          host.schedulerTaskRegistry.register(task);
        }
      } else {
        // Unit-test bootstrap (no ConfigService). Production wiring always
        // passes one; if a runtime path ever lands here, the scheduler
        // task simply doesn't fire and the operator sees the gap via
        // missing cursor advancement. This log line makes the gap
        // greppable when triaging "why isn't branch-1 status-sync running?"
        host.logger(`${PRESTASHOP_BRAND}IntegrationModule`).debug(
          'Skipping scheduler-task registration: no ConfigService provided to createPrestashopPlugin (expected in unit-test bootstraps only).',
        );
      }
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

      return dispatchCapability<T>(
        capability,
        {
          ProductMaster: () => adapters.productMaster,
          InventoryMaster: () => adapters.inventoryMaster,
          OrderSource: () => adapters.orderSource,
          // Null guard preserved — OrderProcessorManager is conditionally
          // wired up by the factory (depends on customer provisioner +
          // customer projection repository). A configured-but-missing
          // OPM is a deeper error than "capability not supported" — keep
          // the bespoke message.
          OrderProcessorManager: () => {
            if (!adapters.orderProcessorManager) {
              throw new Error(
                'OrderProcessorManager adapter is not available. ' +
                  'Customer provisioner and customer projection repository are required for order processing.',
              );
            }
            return adapters.orderProcessorManager;
          },
        },
        PRESTASHOP_BRAND,
      );
    },
  };
}
