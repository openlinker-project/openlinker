/**
 * WooCommerce Integration Module
 *
 * Host wiring for the WooCommerce REST API v3 plugin. WooCommerce has no
 * plugin-specific NestJS providers (no TypeORM repository, no token-refresh
 * service), so it uses the SDK's `createNestAdapterModule` directly: the
 * helper imports the integrations/sync/identifier-mapping modules, builds
 * the `HostServices` bag from DI, registers the manifest + factory, and
 * calls `plugin.register(host)` for the connection tester and validators.
 *
 * Added to `apps/api/src/plugins.ts` and `apps/worker/src/plugins.ts` as
 * the single edit point that enables the plugin in both hosts.
 *
 * @module libs/integrations/woocommerce/src
 */
import type { DynamicModule } from '@nestjs/common';
import { createNestAdapterModule } from '@openlinker/plugin-sdk';
import { createWooCommercePlugin } from './woocommerce-plugin';
import { WooCommerceWebhookProvisioningModule } from './woocommerce-webhook-provisioning.module';

export const WooCommerceIntegrationModule: DynamicModule = createNestAdapterModule({
  plugin: createWooCommercePlugin(),
  // The inbound webhook provisioner (#1548) needs NestJS-injected ConnectionPort
  // + IWebhookSecretService (not in the HostServices bag), so it self-registers
  // from this companion module rather than from plugin.register(host).
  imports: [WooCommerceWebhookProvisioningModule],
});
