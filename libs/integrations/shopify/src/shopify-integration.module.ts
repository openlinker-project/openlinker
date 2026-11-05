/**
 * Shopify Integration Module
 *
 * NestJS host wrapper for the Shopify plugin descriptor, built with
 * `createNestAdapterModule`. Two Nest-provided pieces sit beside the
 * descriptor:
 *   - the mappings service (carrier and payment mappings onto a Shopify
 *     destination), captured at boot into a holder the descriptor reads lazily,
 *     because the descriptor is built when this module is defined;
 *   - the webhook provisioner, registered by a provider factory because it
 *     needs `ConnectionPort` and `IWebhookSecretService`, which the
 *     `HostServices` bag does not carry. Their tokens resolve through the
 *     `IntegrationsModule`, `IdentifierMappingModule` and `RateLimitModule`
 *     imports `createNestAdapterModule` already adds.
 *
 * Wired into `apps/api/src/plugins.ts` and `apps/worker/src/plugins.ts`.
 *
 * @module libs/integrations/shopify/src
 */
import type { DynamicModule } from '@nestjs/common';
import { CONNECTION_PORT_TOKEN, type ConnectionPort } from '@openlinker/core/identifier-mapping';
import {
  CREDENTIALS_RESOLVER_TOKEN,
  WEBHOOK_PROVISIONING_REGISTRY_TOKEN,
  WEBHOOK_SECRET_SERVICE_TOKEN,
  type CredentialsResolverPort,
  type IWebhookSecretService,
  type WebhookProvisioningRegistryService,
} from '@openlinker/core/integrations';
import {
  MappingsModule,
  MAPPING_CONFIG_SERVICE_TOKEN,
  type IMappingConfigService,
} from '@openlinker/core/mappings';
import { HTTP_TRANSPORT_FACTORY_TOKEN, createNestAdapterModule } from '@openlinker/plugin-sdk';
import { CACHE_PORT_TOKEN, type CachePort } from '@openlinker/shared';
import type { HttpTransportFactoryPort } from '@openlinker/shared/http';

import { ShopifyWebhookProvisioningAdapter } from './infrastructure/adapters/shopify-webhook-provisioning.adapter';
import { SHOPIFY_ADAPTER_KEY, SHOPIFY_DEFAULT_RATE_LIMIT } from './shopify.constants';
import { createShopifyPlugin } from './shopify-plugin';

const SHOPIFY_MAPPING_CONFIG_HOLDER = Symbol('ShopifyMappingConfigHolder');
const SHOPIFY_WEBHOOK_PROVISIONER = Symbol('ShopifyWebhookProvisioner');
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
    {
      provide: SHOPIFY_WEBHOOK_PROVISIONER,
      useFactory: (
        registry: WebhookProvisioningRegistryService,
        connectionPort: ConnectionPort,
        webhookSecretService: IWebhookSecretService,
        credentialsResolver: CredentialsResolverPort,
        http: HttpTransportFactoryPort,
        cache: CachePort | undefined,
      ) => {
        const provisioner = new ShopifyWebhookProvisioningAdapter(
          connectionPort,
          webhookSecretService,
          credentialsResolver,
          http,
          new Map(),
          cache,
          SHOPIFY_DEFAULT_RATE_LIMIT,
        );
        registry.register(SHOPIFY_ADAPTER_KEY, provisioner);
        return provisioner;
      },
      inject: [
        WEBHOOK_PROVISIONING_REGISTRY_TOKEN,
        CONNECTION_PORT_TOKEN,
        WEBHOOK_SECRET_SERVICE_TOKEN,
        CREDENTIALS_RESOLVER_TOKEN,
        HTTP_TRANSPORT_FACTORY_TOKEN,
        { token: CACHE_PORT_TOKEN, optional: true },
      ],
    },
  ],
});
