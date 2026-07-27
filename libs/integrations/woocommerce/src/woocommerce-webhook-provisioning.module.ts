/**
 * WooCommerce Webhook Provisioning Module (#1548)
 *
 * Companion NestJS module composed into the WooCommerce plugin via
 * `createNestAdapterModule({ imports: [WooCommerceWebhookProvisioningModule] })`.
 * It exists because the automated webhook provisioner needs NestJS-injected
 * services — `ConnectionPort` (read/patch the connection) and
 * `IWebhookSecretService` (rotate the shared secret) — that are deliberately
 * NOT part of the framework-neutral `HostServices` bag. Rather than restructure
 * the whole WooCommerce plugin onto a custom module, this small module injects
 * exactly those deps + `CredentialsResolverPort` + the provisioning registry,
 * and registers `WooCommerceWebhookProvisioningAdapter` in `onModuleInit`.
 *
 * Mirrors `ErliWebhookProvisioningModule`.
 *
 * @module libs/integrations/woocommerce/src
 */
import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import {
  CredentialsResolverPort,
  CREDENTIALS_RESOLVER_TOKEN,
  IntegrationsModule,
  IWebhookSecretService,
  WEBHOOK_SECRET_SERVICE_TOKEN,
  WebhookProvisioningRegistryService,
  WEBHOOK_PROVISIONING_REGISTRY_TOKEN,
} from '@openlinker/core/integrations';
import {
  ConnectionPort,
  CONNECTION_PORT_TOKEN,
  IdentifierMappingModule,
} from '@openlinker/core/identifier-mapping';
import { woocommerceAdapterManifest } from './woocommerce-plugin';
import { WooCommerceWebhookProvisioningAdapter } from './infrastructure/adapters/woocommerce-webhook-provisioning.adapter';

@Module({
  imports: [IntegrationsModule, IdentifierMappingModule],
})
export class WooCommerceWebhookProvisioningModule implements OnModuleInit {
  constructor(
    @Inject(WEBHOOK_PROVISIONING_REGISTRY_TOKEN)
    private readonly webhookProvisioningRegistry: WebhookProvisioningRegistryService,
    @Inject(CONNECTION_PORT_TOKEN)
    private readonly connectionPort: ConnectionPort,
    @Inject(WEBHOOK_SECRET_SERVICE_TOKEN)
    private readonly webhookSecretService: IWebhookSecretService,
    @Inject(CREDENTIALS_RESOLVER_TOKEN)
    private readonly credentialsResolver: CredentialsResolverPort,
  ) {}

  onModuleInit(): void {
    this.webhookProvisioningRegistry.register(
      woocommerceAdapterManifest.adapterKey,
      new WooCommerceWebhookProvisioningAdapter(
        this.connectionPort,
        this.webhookSecretService,
        this.credentialsResolver,
      ),
    );
  }
}
