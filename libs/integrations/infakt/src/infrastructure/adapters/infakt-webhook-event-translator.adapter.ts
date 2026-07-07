/**
 * Infakt Webhook Event Translator Adapter (#1281, ADR-015)
 *
 * Decodes the neutral envelope produced by `InfaktInboundWebhookDecoderAdapter`
 * into a `CanonicalInboundEvent`. The neutral domain is decided by
 * `InfaktWebhookTranslator.toOlDomain` (one source of truth with the
 * already-tested POC class): KSeF-clearance events (`send_to_ksef_success` /
 * `send_to_ksef_error`) → `invoicing`; payment events (`invoice_marked_as_paid` /
 * `invoice_marked_as_paid_via_async_api`, #1354) → `invoice-payment`. Every
 * other Infakt event (`draft_invoice_created`, …) is well-formed but not
 * actionable by OL → `null` (dead-letter), per the translator's total-function
 * contract.
 *
 * @module libs/integrations/infakt/src/infrastructure/adapters
 */
import type { InboundWebhookEvent } from '@openlinker/core/events';
import type {
  CanonicalInboundEvent,
  WebhookEventTranslatorPort,
} from '@openlinker/core/integrations';
import { Logger } from '@openlinker/shared/logging';
import { InfaktWebhookTranslator } from '../webhooks/infakt-webhook-translator';

export class InfaktWebhookEventTranslatorAdapter implements WebhookEventTranslatorPort {
  /** Secret-independent parsing helpers only — this adapter never verifies signatures. */
  private readonly translator = InfaktWebhookTranslator.forParsing(
    new Logger(InfaktWebhookEventTranslatorAdapter.name),
  );

  translate(event: InboundWebhookEvent): CanonicalInboundEvent | null {
    if (event.objectType !== 'invoice') {
      return null;
    }
    const domain = this.translator.toOlDomain(event.eventType);
    if (domain === null) {
      return null;
    }
    return {
      domain,
      externalId: event.externalId,
      eventType: event.eventType,
      occurredAt: event.occurredAt,
      payload: event.payload,
    };
  }
}
