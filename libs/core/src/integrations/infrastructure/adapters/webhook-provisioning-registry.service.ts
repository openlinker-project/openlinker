/**
 * Webhook Provisioning Registry Service
 *
 * Holds `WebhookProvisioningPort` implementations keyed by `adapterKey`.
 * Integration modules register their provisioners at bootstrap alongside
 * their adapter factory + connection tester, mirroring the shape of
 * `AdapterFactoryResolverService` and `ConnectionTesterRegistryService`
 * (#583). Consumed by `ConnectionService.installWebhooks` to route the
 * generic `POST /connections/:id/webhooks/install` endpoint to the right
 * per-platform provisioner — replacing the previous direct injection of
 * the PS-specific service that prevented `apps/api` from booting without
 * the PrestaShop integration loaded.
 *
 * Silent overwrite on duplicate `adapterKey` mirrors the sister
 * `ConnectionTesterRegistryService.register`; integration modules
 * register exactly once at boot so collisions are near-impossible by
 * construction.
 *
 * @module libs/core/src/integrations/infrastructure/adapters
 * @see {@link WebhookProvisioningPort} for the port interface
 */
import { Injectable } from '@nestjs/common';
import type { WebhookProvisioningPort } from '../../domain/ports/webhook-provisioning.port';

@Injectable()
export class WebhookProvisioningRegistryService {
  private readonly provisioners: Map<string, WebhookProvisioningPort> = new Map();

  register(adapterKey: string, provisioner: WebhookProvisioningPort): void {
    this.provisioners.set(adapterKey, provisioner);
  }

  get(adapterKey: string): WebhookProvisioningPort | undefined {
    return this.provisioners.get(adapterKey);
  }

  has(adapterKey: string): boolean {
    return this.provisioners.has(adapterKey);
  }
}
