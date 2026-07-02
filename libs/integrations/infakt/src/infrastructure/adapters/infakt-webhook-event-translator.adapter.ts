/**
 * Infakt Webhook Event Translator Adapter (#1281, ADR-015)
 *
 * Decodes the neutral envelope produced by `InfaktInboundWebhookDecoderAdapter`
 * into a `CanonicalInboundEvent` on the `invoicing` domain. Only the two
 * KSeF-clearance event names Infakt confirmed live
 * (`send_to_ksef_success` / `send_to_ksef_error`) route through — reused from
 * `InfaktWebhookTranslator.toOlDomain` so the allowlist has one source of
 * truth with the already-tested POC class. Every other Infakt event
 * (`draft_invoice_created`, `invoice_marked_as_paid`, …) is well-formed but
 * not yet actionable by OL → `null` (dead-letter), per the translator's
 * total-function contract.
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
    if (this.translator.toOlDomain(event.eventType) !== 'invoicing') {
      return null;
    }
    return {
      domain: 'invoicing',
      externalId: event.externalId,
      eventType: event.eventType,
      occurredAt: event.occurredAt,
      payload: event.payload,
    };
  }
}
