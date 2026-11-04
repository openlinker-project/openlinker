/**
 * Shopify Integration Module
 *
 * NestJS host wrapper for the Shopify plugin descriptor, built with
 * `createNestAdapterModule`: the plugin needs nothing beyond the
 * `HostServices` bag (no Nest-provided provisioner, unlike Shoper - Shopify
 * creates an order without a customer record OpenLinker must manage).
 *
 * Wired into `apps/api/src/plugins.ts` and `apps/worker/src/plugins.ts`.
 *
 * @module libs/integrations/shopify/src
 */
import type { DynamicModule } from '@nestjs/common';
import { createNestAdapterModule } from '@openlinker/plugin-sdk';

import { createShopifyPlugin } from './shopify-plugin';

export const ShopifyIntegrationModule: DynamicModule = createNestAdapterModule({
  plugin: createShopifyPlugin(),
});
