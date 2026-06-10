/**
 * InPost Webhook Event Translator Adapter (#768, ADR-015 / ADR-021)
 *
 * Downstream complement to the decoder: maps the host's neutral
 * `InboundWebhookEvent` (already authenticated + enveloped by the decoder, then
 * published to the bus) into a `CanonicalInboundEvent` the core
 * `InboundRoutingPolicy` routes. InPost emits only the `shipment` domain; the
 * routing policy turns that into `marketplace.shipment.syncByExternalId`.
 *
 * Total transform — returns `null` for object types it doesn't decode
 * (→ dead-letter), never throws.
 *
 * @module libs/integrations/inpost/src/infrastructure/adapters
 */
import type { InboundWebhookEvent } from '@openlinker/core/events';
import type {
  CanonicalInboundEvent,
  WebhookEventTranslatorPort,
} from '@openlinker/core/integrations';

export class InpostWebhookEventTranslatorAdapter implements WebhookEventTranslatorPort {
  translate(event: InboundWebhookEvent): CanonicalInboundEvent | null {
    if (event.objectType !== 'shipment') {
      return null;
    }
    return {
      domain: 'shipment',
      externalId: event.externalId,
      eventType: event.eventType,
      occurredAt: event.occurredAt,
      payload: event.payload,
    };
  }
}
