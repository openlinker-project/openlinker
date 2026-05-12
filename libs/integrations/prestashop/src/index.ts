/**
 * PrestaShop Integration Library Exports
 *
 * Public API for the PrestaShop WebService v1 adapter. Exports adapters,
 * factory, types, and exceptions for use by the adapter registry and
 * IntegrationsService.
 *
 * @module libs/integrations/prestashop/src
 */

// Factory
export { PrestashopAdapterFactory } from './application/prestashop-adapter.factory';
export { IPrestashopAdapterFactory } from './application/interfaces/prestashop-adapter.factory.interface';

// Plugin descriptor (#593) — replaces the previous `PrestashopAdapterFactoryWrapper`
// shim. The descriptor lives on top of the `@openlinker/plugin-sdk` contract.
// `prestashopAdapterManifest` is the static manifest export (#575) — readable
// without booting Nest or resolving the cross-package deps in
// `CreatePrestashopPluginDeps`.
export {
  createPrestashopPlugin,
  prestashopAdapterManifest,
  type CreatePrestashopPluginDeps,
} from './prestashop-plugin';

// Webhook provisioning (#168 / #583) — implements core's WebhookProvisioningPort
export { PrestashopWebhookProvisioningAdapter } from './infrastructure/adapters/prestashop-webhook-provisioning.adapter';

// Adapters
export { PrestashopProductMasterAdapter } from './infrastructure/adapters/prestashop-product-master.adapter';
export { PrestashopInventoryMasterAdapter } from './infrastructure/adapters/prestashop-inventory-master.adapter';
export { PrestashopOrderSourceAdapter } from './infrastructure/adapters/prestashop-order-source.adapter';

// Types
export * from './domain/types/prestashop-config.types';
export * from './domain/types/prestashop-credentials.types';

// Exceptions
export { PrestashopConfigException } from './domain/exceptions/prestashop-config.exception';
export { PrestashopAuthenticationException } from './domain/exceptions/prestashop-authentication.exception';
export { PrestashopResourceNotFoundException } from './domain/exceptions/prestashop-resource-not-found.exception';
export { PrestashopApiException } from './domain/exceptions/prestashop-api.exception';
export { PrestashopNotSupportedException } from './domain/exceptions/prestashop-not-supported.exception';
export { PrestashopParseException } from './domain/exceptions/prestashop-parse.exception';
export { PrestashopCountryNotFoundException } from './domain/exceptions/prestashop-country-not-found.exception';
export { PrestashopProvisioningException } from './domain/exceptions/prestashop-provisioning.exception';

// Module
export { PrestashopIntegrationModule } from './prestashop-integration.module';

