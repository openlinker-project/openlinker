/**
 * Amazon Notifications Module (#4179)
 *
 * The two notification pieces that need `ConnectionPort`, which `HostServices`
 * does not carry (the `ErliWebhookProvisioningModule` shape); composed into
 * `AmazonIntegrationModule` through `createNestAdapterModule({ imports })`:
 *
 *   - `AmazonNotificationProvisioningAdapter` for the "Configure webhooks"
 *     action (Notifications API destination + `ORDER_CHANGE` subscription);
 *   - the `amazon-notifications-drain` scheduler task, whose connection filter
 *     lists only the connections that name a notification queue.
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
import {
  SCHEDULER_TASK_REGISTRY_TOKEN,
  SchedulerTaskRegistryService,
  SyncModule,
} from '@openlinker/core/sync';
import { RateLimitModule, HTTP_TRANSPORT_FACTORY_TOKEN } from '@openlinker/plugin-sdk';
import { HttpTransportFactoryPort } from '@openlinker/shared/http';

import { AMAZON_ADAPTER_KEY } from './amazon.constants';
import { AmazonAdapterFactory } from './application/amazon-adapter.factory';
import { AmazonNotificationProvisioningAdapter } from './infrastructure/adapters/amazon-notification-provisioning.adapter';
import { buildAmazonNotificationsDrainTask } from './infrastructure/scheduler/amazon-scheduler-tasks';

@Module({
  imports: [IntegrationsModule, IdentifierMappingModule, SyncModule, RateLimitModule],
})
export class AmazonNotificationsModule implements OnModuleInit {
  constructor(
    @Inject(WEBHOOK_PROVISIONING_REGISTRY_TOKEN)
    private readonly webhookProvisioningRegistry: WebhookProvisioningRegistryService,
    @Inject(SCHEDULER_TASK_REGISTRY_TOKEN)
    private readonly schedulerTaskRegistry: SchedulerTaskRegistryService,
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
    this.schedulerTaskRegistry.register(
      buildAmazonNotificationsDrainTask((filters) => this.connectionPort.list(filters)),
    );
  }
}
