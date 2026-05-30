/**
 * Webhook Event Translator Registry Service
 *
 * Holds `WebhookEventTranslatorPort` implementations keyed by `adapterKey`.
 * Integration plugins register their translator in `register(host)` at
 * bootstrap, mirroring `WebhookProvisioningRegistryService` /
 * `ConnectionTesterRegistryService` (ADR-015). Consumed by the inbound
 * webhook dispatcher (`WebhookToJobHandler`) to decode a connection's native
 * event into a neutral `CanonicalInboundEvent` before the core routing policy
 * decides the job — so the dispatcher carries zero platform knowledge.
 *
 * Silent overwrite on duplicate `adapterKey` mirrors the sister registries;
 * plugins register exactly once at boot.
 *
 * @module libs/core/src/integrations/infrastructure/adapters
 * @see {@link WebhookEventTranslatorPort} for the port interface
 */
import { Injectable } from '@nestjs/common';
import type { WebhookEventTranslatorPort } from '../../domain/ports/webhook-event-translator.port';

@Injectable()
export class WebhookEventTranslatorRegistryService {
  private readonly translators: Map<string, WebhookEventTranslatorPort> = new Map();

  register(adapterKey: string, translator: WebhookEventTranslatorPort): void {
    this.translators.set(adapterKey, translator);
  }

  get(adapterKey: string): WebhookEventTranslatorPort | undefined {
    return this.translators.get(adapterKey);
  }

  has(adapterKey: string): boolean {
    return this.translators.has(adapterKey);
  }
}
