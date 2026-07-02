/**
 * Erli Webhook Event Translator Adapter (#996 / ADR-015)
 *
 * Decodes Erli's inbound webhook events into neutral `CanonicalInboundEvent`s.
 * Pure transform — no I/O, no connection state, no DI. `ErliInboundWebhookDecoderAdapter`
 * (#1081, native decoder — confirmed against the live sandbox, #992) always emits
 * `orderStatusChanged`, since the real body carries no event-type discriminator to tell
 * `orderCreated` apart, mapped below to canonical `updated`. The `orderCreated`
 * branch is kept for defensiveness / forward-compat if a future decoder
 * revision recovers a real discriminator — it is NOT reachable from today's decoder:
 *   - `orderCreated`       → canonical `{ domain: 'order', eventType: 'created' }`
 *   - `orderStatusChanged` → canonical `{ domain: 'order', eventType: 'updated' }`
 *
 * This is the only place that holds Erli's webhook vocabulary — the core
 * routing policy maps `domain → job` with zero platform knowledge. Unknown
 * event types return `null` (→ dead-letter), keeping the translator **total**:
 * it NEVER throws (ADR-015 invariant 5).
 *
 * The order id is narrowed DEFENSIVELY from `unknown`: it originates from an
 * untrusted webhook body, so anything that is not a non-empty string yields
 * `null` rather than a malformed event.
 *
 * @module libs/integrations/erli/src/infrastructure/adapters
 * @see {@link WebhookEventTranslatorPort} for the port interface
 * @see {@link ErliInboundWebhookDecoderAdapter} for the decoder this translator consumes
 */
import type { InboundWebhookEvent } from '@openlinker/core/events';
import type {
  CanonicalInboundEvent,
  WebhookEventTranslatorPort,
} from '@openlinker/core/integrations';
import {
  ERLI_WEBHOOK_ORDER_ID_FIELD,
  type ErliWebhookEventType,
} from './erli-webhook.types';

export class ErliWebhookEventTranslator implements WebhookEventTranslatorPort {
  translate(event: InboundWebhookEvent): CanonicalInboundEvent | null {
    const eventType = this.resolveEventType(event.eventType);
    if (eventType === null) {
      // Unknown / unhandled event type — not decodable by this plugin → dead-letter.
      return null;
    }

    const externalId = this.resolveExternalId(event);
    if (externalId === null) {
      // Missing / non-string order id — undecodable → dead-letter.
      return null;
    }

    return {
      domain: 'order',
      externalId,
      eventType,
      occurredAt: event.occurredAt,
      payload: event.payload,
    };
  }

  /**
   * Map the Erli webhook event-type discriminator into the order domain's
   * advisory vocabulary. `orderStatusChanged` (and any unrecognized order
   * event) is an `updated` (a safe re-pull); `orderCreated` is a `created`.
   * Returns `null` for event types this plugin does not handle.
   */
  private resolveEventType(raw: string): 'created' | 'updated' | null {
    const eventType = raw as ErliWebhookEventType;
    switch (eventType) {
      case 'orderCreated':
        return 'created';
      case 'orderStatusChanged':
        return 'updated';
      default:
        return null;
    }
  }

  /**
   * Resolve the external order id, treating both the event's own `externalId`
   * and its `payload` as untrusted. Prefers `externalId`; falls back to the
   * provisional `payload[ERLI_WEBHOOK_ORDER_ID_FIELD]`. Returns `null` unless a
   * non-empty trimmed string is found.
   */
  private resolveExternalId(event: InboundWebhookEvent): string | null {
    const fromExternalId = this.asNonEmptyString(event.externalId);
    if (fromExternalId !== null) {
      return fromExternalId;
    }

    const payload: unknown = event.payload;
    if (payload !== null && typeof payload === 'object') {
      const candidate = (payload as Record<string, unknown>)[ERLI_WEBHOOK_ORDER_ID_FIELD];
      return this.asNonEmptyString(candidate);
    }

    return null;
  }

  private asNonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
}
