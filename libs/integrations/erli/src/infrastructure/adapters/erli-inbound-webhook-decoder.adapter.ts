/**
 * Erli Inbound Webhook Decoder Adapter (#1081, ADR-021)
 *
 * Authenticates + decodes Erli inbound order webhooks at the host ingress,
 * keyed by `provider = 'erli'`. The verify half checks the `accessToken` Erli
 * echoes back in the `ERLI_WEBHOOK_ACCESS_TOKEN_HEADER` header against the
 * per-connection shared secret stored OL-side by `IWebhookSecretService`
 * (provisioned by `ErliWebhookProvisioningAdapter`, #996).
 *
 * PROVISIONAL (#992): the header name, body field paths, and the presence of a
 * delivery timestamp are all unconfirmed until the sandbox spike. All wire
 * assumptions are isolated in `erli-webhook.types.ts` — when #992 lands,
 * that file is the single reconciliation point.
 *
 * Trigger model (ADR-025): webhook is a low-latency nudge, never the source
 * of truth. We read only the order id from the body; the authoritative order
 * is fetched downstream by `ErliOrderSourceAdapter.getOrder` via the
 * `marketplace.order.sync` job.
 *
 * @module libs/integrations/erli/src/infrastructure/adapters
 * @see {@link InboundWebhookDecoderPort} for the port interface
 * @see {@link ErliWebhookProvisioningAdapter} for the provisioner that sets the secret
 * @see {@link ErliWebhookEventTranslator} for the downstream translator
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type {
  DecodeResult,
  InboundWebhookDecoderPort,
  WebhookVerifyResult,
} from '@openlinker/core/integrations';
import {
  ERLI_WEBHOOK_ACCESS_TOKEN_HEADER,
  ERLI_WEBHOOK_EVENT_TYPE_FIELD,
  ERLI_WEBHOOK_ORDER_ID_FIELD,
  ErliWebhookEventTypeValues,
} from './erli-webhook.types';

export class ErliInboundWebhookDecoderAdapter implements InboundWebhookDecoderPort {
  verify(input: {
    rawBody: Buffer;
    headers: Record<string, string>;
    secret: string;
  }): WebhookVerifyResult {
    const token = this.header(input.headers, ERLI_WEBHOOK_ACCESS_TOKEN_HEADER);
    if (!token) {
      return { ok: false };
    }
    const provided = Buffer.from(token);
    const expected = Buffer.from(input.secret);
    if (provided.length !== expected.length) {
      return { ok: false };
    }
    if (!timingSafeEqual(provided, expected)) {
      return { ok: false };
    }
    // PROVISIONAL (#992): Erli does not send a signed timestamp header, so
    // `timestampMs` is omitted intentionally — the host's replay-window check
    // only fires when the field is present.
    return { ok: true };
  }

  extractEnvelope(rawBody: Buffer, _headers: Record<string, string>): DecodeResult {
    let body: unknown;
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return { action: 'reject', reason: 'body is not valid JSON' };
    }
    if (typeof body !== 'object' || body === null) {
      return { action: 'reject', reason: 'body is not a JSON object' };
    }
    const record = body as Record<string, unknown>;

    const rawEventType = this.asNonEmptyString(record[ERLI_WEBHOOK_EVENT_TYPE_FIELD]);
    if (!rawEventType) {
      return { action: 'reject', reason: 'missing or empty event type field' };
    }
    if (
      !ErliWebhookEventTypeValues.includes(
        rawEventType as (typeof ErliWebhookEventTypeValues)[number],
      )
    ) {
      return { action: 'ignore', reason: `unhandled event type: ${rawEventType}` };
    }
    const eventType = rawEventType;

    const orderId = this.asNonEmptyString(record[ERLI_WEBHOOK_ORDER_ID_FIELD]);
    if (!orderId) {
      return { action: 'reject', reason: 'missing or empty orderId field' };
    }

    return {
      action: 'route',
      envelope: {
        eventId: this.deriveEventId(record, orderId, eventType),
        eventType,
        occurredAt: this.resolveOccurredAt(record),
        objectType: 'order',
        externalId: orderId,
        payload: { [ERLI_WEBHOOK_ORDER_ID_FIELD]: orderId },
      },
    };
  }

  private deriveEventId(
    record: Record<string, unknown>,
    orderId: string,
    eventType: string,
  ): string {
    const explicit =
      this.asNonEmptyString(record['eventId']) ?? this.asNonEmptyString(record['id']);
    if (explicit) {
      return explicit;
    }
    const basis = `${orderId}:${eventType}`;
    return `erli-${createHash('sha256').update(basis).digest('hex').slice(0, 32)}`;
  }

  private resolveOccurredAt(record: Record<string, unknown>): string {
    const fromBody =
      this.asNonEmptyString(record['occurredAt']) ??
      this.asNonEmptyString(record['timestamp']) ??
      this.asNonEmptyString(record['createdAt']);
    // Advisory only — authoritative timestamp comes from the downstream order
    // fetch (ADR-025 trigger-not-truth model).
    return fromBody ?? new Date().toISOString();
  }

  private header(headers: Record<string, string>, name: string): string | null {
    return headers[name] ?? headers[name.toLowerCase()] ?? null;
  }

  private asNonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
}
