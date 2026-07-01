/**
 * Erli Inbound Webhook Decoder Adapter (#1081, ADR-021)
 *
 * Authenticates + decodes Erli inbound order webhooks at the host ingress,
 * keyed by `provider = 'erli'`. The verify half checks the `accessToken` Erli
 * echoes back on the `ERLI_WEBHOOK_ACCESS_TOKEN_HEADER` (`Authorization`)
 * header against the per-connection shared secret stored OL-side by
 * `IWebhookSecretService` (provisioned by `ErliWebhookProvisioningAdapter`, #996).
 *
 * CONFIRMED (#992 sandbox spike, 2026-07-01): the body is the full order
 * resource with no event-type discriminator (see `erli-webhook.types.ts`), so
 * `extractEnvelope` always emits a generic `'orderStatusChanged'` envelope
 * eventType — every delivery is treated as "go re-fetch this order", which is
 * both hooks' only decodable signal. Erli sends no signed delivery timestamp.
 * `ErliWebhookEventTranslator` still special-cases a hypothetical
 * `orderCreated` discriminator for forward-compat — this decoder never emits
 * it today, so don't go looking for it here if that branch looks dead.
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
  ERLI_WEBHOOK_AUTH_HEADER_PREFIX,
  ERLI_WEBHOOK_ORDER_ID_FIELD,
} from './erli-webhook.types';

export class ErliInboundWebhookDecoderAdapter implements InboundWebhookDecoderPort {
  verify(input: {
    rawBody: Buffer;
    headers: Record<string, string>;
    secret: string;
  }): WebhookVerifyResult {
    const header = this.header(input.headers, ERLI_WEBHOOK_ACCESS_TOKEN_HEADER);
    if (!header) {
      return { ok: false };
    }
    // Scheme match is case-insensitive: RFC 7235 doesn't mandate a case for
    // the auth-scheme token, and a lowercase `bearer ` from Erli or an
    // intermediary proxy must not fall through to a raw-header comparison
    // that always fails the length check.
    const token = header.toLowerCase().startsWith(ERLI_WEBHOOK_AUTH_HEADER_PREFIX.toLowerCase())
      ? header.slice(ERLI_WEBHOOK_AUTH_HEADER_PREFIX.length)
      : header;
    const provided = Buffer.from(token);
    const expected = Buffer.from(input.secret);
    if (provided.length !== expected.length) {
      return { ok: false };
    }
    if (!timingSafeEqual(provided, expected)) {
      return { ok: false };
    }
    // Erli does not send a signed timestamp header, so `timestampMs` is
    // omitted intentionally — the host's replay-window check only fires when
    // the field is present.
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

    const orderId = this.asNonEmptyString(record[ERLI_WEBHOOK_ORDER_ID_FIELD]);
    if (!orderId) {
      return { action: 'reject', reason: 'missing or empty order id field' };
    }

    // No body discriminator exists (see module doc) — every delivery decodes
    // to the same generic "order changed" signal.
    const eventType = 'orderStatusChanged';
    const bodyTimestamp = this.resolveBodyTimestamp(record);
    const occurredAt = bodyTimestamp ?? new Date().toISOString();

    return {
      action: 'route',
      envelope: {
        // `occurredAt` (Erli's own `updated` timestamp) is load-bearing here,
        // not just advisory: it is one of the fields (alongside `status`,
        // see `deriveEventId`) that makes eventIds for the SAME order's
        // successive deliveries (create, then cancel, ...) distinct. Without
        // it every delivery would hash to `${orderId}:${status}:no-timestamp`
        // and the Postgres eventId-dedup gate would collapse same-status
        // repeats together.
        eventId: this.deriveEventId(record, orderId, bodyTimestamp),
        eventType,
        occurredAt,
        objectType: 'order',
        externalId: orderId,
        payload: { [ERLI_WEBHOOK_ORDER_ID_FIELD]: orderId },
      },
    };
  }

  private deriveEventId(
    record: Record<string, unknown>,
    orderId: string,
    bodyTimestamp: string | null,
  ): string {
    const explicit = this.asNonEmptyString(record['eventId']);
    if (explicit) {
      return explicit;
    }
    // The hash basis intentionally never includes the "now" fallback used for
    // the envelope's advisory `occurredAt` - that value is decode-time and
    // non-deterministic, so hashing it would produce a fresh eventId on every
    // retried delivery and defeat the Postgres eventId-dedup gate. `status` is
    // folded in alongside the timestamp so a timestamp-less body still gets
    // distinct eventIds across a real status change (e.g. created -> paid),
    // rather than collapsing every timestamp-less delivery for the same order
    // onto one eventId and relying solely on the reconciliation poll to catch
    // the dropped ones. Retried deliveries of the identical body still hash
    // to the same eventId (id + status + timestamp are all unchanged), so the
    // dedup gate still catches true retries.
    const status = this.asNonEmptyString(record['status']) ?? 'no-status';
    const timestamp = bodyTimestamp ?? 'no-timestamp';
    const basis = `${orderId}:${status}:${timestamp}`;
    return `erli-${createHash('sha256').update(basis).digest('hex').slice(0, 32)}`;
  }

  private resolveBodyTimestamp(record: Record<string, unknown>): string | null {
    return (
      this.asNonEmptyString(record['updated']) ??
      this.asNonEmptyString(record['occurredAt']) ??
      this.asNonEmptyString(record['timestamp']) ??
      this.asNonEmptyString(record['created'])
    );
  }

  private header(headers: Record<string, string>, name: string): string | null {
    const lower = name.toLowerCase();
    const entry = Object.entries(headers).find(([k]) => k.toLowerCase() === lower);
    return entry?.[1] ?? null;
  }

  private asNonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
}
