/**
 * Shopify Integration Module
 *
 * NestJS host wrapper for the Shopify plugin descriptor, built with
 * `createNestAdapterModule`. The one Nest-provided service the plugin reads is
 * the mappings service (carrier and payment mappings onto a Shopify
 * destination); a provider captures it at boot into a holder the descriptor
 * reads lazily, because the descriptor is built when this module is defined.
 *
 * Wired into `apps/api/src/plugins.ts` and `apps/worker/src/plugins.ts`.
 *
 * @module libs/integrations/shopify/src
 */
import type { DynamicModule } from '@nestjs/common';
import {
  MappingsModule,
  MAPPING_CONFIG_SERVICE_TOKEN,
  type IMappingConfigService,
} from '@openlinker/core/mappings';
import { createNestAdapterModule } from '@openlinker/plugin-sdk';

import { createShopifyPlugin } from './shopify-plugin';

const SHOPIFY_MAPPING_CONFIG_HOLDER = Symbol('ShopifyMappingConfigHolder');
const mappingConfigHolder: { service?: IMappingConfigService } = {};

export const ShopifyIntegrationModule: DynamicModule = createNestAdapterModule({
  plugin: createShopifyPlugin({ mappingConfig: () => mappingConfigHolder.service }),
  imports: [MappingsModule],
  providers: [
    {
      provide: SHOPIFY_MAPPING_CONFIG_HOLDER,
      useFactory: (service: IMappingConfigService) => {
        mappingConfigHolder.service = service;
        return mappingConfigHolder;
      },
      inject: [MAPPING_CONFIG_SERVICE_TOKEN],
    },
  ],
});
