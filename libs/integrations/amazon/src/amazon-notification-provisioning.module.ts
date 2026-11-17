/**
 * Amazon Notification Provisioning Module (#4179)
 *
 * Registers `AmazonNotificationProvisioningAdapter` for the "Configure
 * webhooks" action. A module of its own because the provisioner needs
 * `ConnectionPort`, which `HostServices` does not carry (the
 * `ErliWebhookProvisioningModule` shape); composed into
 * `AmazonIntegrationModule` through `createNestAdapterModule({ imports })`.
 *
 * @module libs/integrations/amazon/src
 */
import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import {
  CredentialsResolverPort,
  CREDENTIALS_RESOLVER_TOKEN,
  IntegrationsModule,
  WebhookProvisioningRegistryService,
  WEBHOOK_PROVISIONING_REGISTRY_TOKEN,
} from '@openlinker/core/integrations';
import { ConnectionPort, CONNECTION_PORT_TOKEN, IdentifierMappingModule } from '@openlinker/core/identifier-mapping';
import { RateLimitModule, HTTP_TRANSPORT_FACTORY_TOKEN } from '@openlinker/plugin-sdk';
import { HttpTransportFactoryPort } from '@openlinker/shared/http';

import { AMAZON_ADAPTER_KEY } from './amazon.constants';
import { AmazonAdapterFactory } from './application/amazon-adapter.factory';
import { AmazonNotificationProvisioningAdapter } from './infrastructure/adapters/amazon-notification-provisioning.adapter';

@Module({
  imports: [IntegrationsModule, IdentifierMappingModule, RateLimitModule],
})
export class AmazonNotificationProvisioningModule implements OnModuleInit {
  constructor(
    @Inject(WEBHOOK_PROVISIONING_REGISTRY_TOKEN)
    private readonly webhookProvisioningRegistry: WebhookProvisioningRegistryService,
    @Inject(CONNECTION_PORT_TOKEN)
    private readonly connectionPort: ConnectionPort,
    @Inject(CREDENTIALS_RESOLVER_TOKEN)
    private readonly credentialsResolver: CredentialsResolverPort,
    @Inject(HTTP_TRANSPORT_FACTORY_TOKEN)
    private readonly http: HttpTransportFactoryPort,
  ) {}

  onModuleInit(): void {
    this.webhookProvisioningRegistry.register(
      AMAZON_ADAPTER_KEY,
      new AmazonNotificationProvisioningAdapter(
        this.connectionPort,
        this.credentialsResolver,
        new AmazonAdapterFactory(),
        this.http,
      ),
    );
  }
}
