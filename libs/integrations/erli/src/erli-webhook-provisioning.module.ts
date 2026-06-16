/**
 * Erli Webhook Provisioning Module (#996)
 *
 * Companion NestJS module composed into the Erli plugin via
 * `createNestAdapterModule({ imports: [ErliWebhookProvisioningModule] })`. It
 * exists because the automated webhook provisioner needs NestJS-injected
 * services — `ConnectionPort` (read/patch the connection) and
 * `IWebhookSecretService` (rotate the shared secret) — that are deliberately
 * NOT part of the framework-neutral `HostServices` bag. Rather than restructure
 * the whole Erli plugin onto a custom module, this small module injects exactly
 * those deps + `CredentialsResolverPort` + the provisioning registry, and
 * registers `ErliWebhookProvisioningAdapter` in `onModuleInit`.
 *
 * @module libs/integrations/erli/src
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
import { ERLI_ADAPTER_KEY } from './erli.constants';
import { ErliWebhookProvisioningAdapter } from './infrastructure/adapters/erli-webhook-provisioning.adapter';

@Module({
  imports: [IntegrationsModule, IdentifierMappingModule],
})
export class ErliWebhookProvisioningModule implements OnModuleInit {
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
      ERLI_ADAPTER_KEY,
      new ErliWebhookProvisioningAdapter(
        this.connectionPort,
        this.webhookSecretService,
        this.credentialsResolver,
      ),
    );
  }
}
