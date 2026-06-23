/**
 * Erli Inbound Webhook Decoder Adapter (#1145, ADR-021)
 *
 * Authenticates + decodes Erli order webhooks at the host ingress, keyed by
 * `provider = 'erli'`. Closes the dead receive path left by #996: without a
 * native decoder the host's fail-closed OL-HMAC default rejected 100% of real
 * Erli deliveries.
 *
 * verify (confirmed against the Erli Shop API docs, https://erli.pl/svc/shop-api/doc/):
 * Erli authenticates each delivery with `Authorization: Bearer {accessToken}`,
 * echoing back the exact shared secret OL set via `PUT /hooks` — there is NO
 * HMAC signature and NO timestamp. So verify is a timing-safe compare of the
 * Bearer token against the per-connection secret the host resolves via
 * `WebhookSecretProviderPort` and passes in. With no signed timestamp we return
 * no `timestampMs`, so the host's shared replay-window check is correctly
 * skipped (the `eventId` Postgres dedup + the #993 poll are the safety net).
 *
 * extract: the body is `{ id, status }` (id = external order id). We read ONLY
 * the id (and status, for dedup) — never trust the wire status as state. The
 * body carries no created-vs-updated discriminator, so we emit `orderStatusChanged`
 * (→ translator `updated` → a full re-pull via `getOrder`). ADR-015
 * trigger-not-truth: an imperfect payload degrades to a redundant re-read,
 * never wrong state.
 *
 * Totality (ADR-015): verify/extract never throw; extract returns
 * route | ignore | reject. The Bearer secret is never logged (no logging here).
 *
 * @module libs/integrations/erli/src/infrastructure/adapters
 * @see {@link InboundWebhookDecoderPort} for the port interface
 * @see {@link ErliWebhookEventTranslator} for the downstream (adapterKey-keyed) translator
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type {
  DecodeResult,
  InboundWebhookDecoderPort,
  WebhookVerifyResult,
} from '@openlinker/core/integrations';
import {
  ERLI_WEBHOOK_ORDER_ID_FIELD,
  ERLI_WEBHOOK_ORDER_STATUS_FIELD,
  type ErliWebhookEventType,
} from './erli-webhook.types';

const AUTHORIZATION_HEADER = 'authorization';
const BEARER_PREFIX = 'bearer ';

/**
 * The body carries no created-vs-updated discriminator (both hooks POST the same
 * shape to the same URL), so every Erli webhook decodes to `orderStatusChanged`
 * → the translator maps it to `updated` → a safe full re-pull. Typed against the
 * hook-name union so a vocabulary change is caught at compile time.
 */
const DEFAULT_EVENT_TYPE: ErliWebhookEventType = 'orderStatusChanged';

export class ErliInboundWebhookDecoderAdapter implements InboundWebhookDecoderPort {
  verify(input: {
    rawBody: Buffer;
    headers: Record<string, string>;
    secret: string;
  }): WebhookVerifyResult {
    const authorization = this.header(input.headers, AUTHORIZATION_HEADER);
    if (!authorization || !authorization.toLowerCase().startsWith(BEARER_PREFIX)) {
      return { ok: false };
    }
    const token = authorization.slice(BEARER_PREFIX.length).trim();
    if (token.length === 0) {
      return { ok: false };
    }

    // Timing-safe compare against the per-connection shared secret. Guard length
    // first — timingSafeEqual throws on unequal-length buffers.
    const provided = Buffer.from(token);
    const expected = Buffer.from(input.secret);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      return { ok: false };
    }

    // Erli sends no signed timestamp, so we return none → the host skips the
    // shared replay-window check (eventId dedup + #993 poll backstop instead).
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
    const externalId = this.nonEmptyString(record[ERLI_WEBHOOK_ORDER_ID_FIELD]);
    if (externalId === null) {
      // Well-formed JSON object but no order id — not an order webhook (e.g. a
      // productsNeedSync delivery or a setup ping). Ack-and-ignore (202) rather
      // than 400 so non-order traffic isn't treated as malformed.
      return { action: 'ignore', reason: 'no order id in webhook body' };
    }

    const status = this.nonEmptyString(record[ERLI_WEBHOOK_ORDER_STATUS_FIELD]) ?? '';

    return {
      action: 'route',
      envelope: {
        eventId: this.deriveEventId(externalId, status),
        eventType: DEFAULT_EVENT_TYPE,
        // Erli sends no event timestamp; stamp decode-time so the required
        // `occurredAt` is populated. Advisory only (the re-pull is authoritative)
        // and deliberately NOT part of `eventId`, so true retries still dedup.
        occurredAt: new Date().toISOString(),
        objectType: 'order',
        externalId,
        // Forward ONLY the advisory status hint — never the raw body. The order
        // is re-pulled authoritatively downstream (trigger-not-truth), so a
        // minimal payload avoids carrying any field Erli might add later onto
        // the published event (mirrors the order mapper's PII-off-metadata
        // discipline; InPost forwards no payload at all).
        ...(status ? { payload: { status } } : {}),
      },
    };
  }

  /**
   * Deterministic dedup key from the stable body fields `id` + `status`. Same
   * order + same status collapses true retries; a distinct transition
   * (pending → shipped → cancelled) yields a distinct id. Best-effort — the
   * idempotent downstream re-read is the correctness guarantee.
   */
  private deriveEventId(externalId: string, status: string): string {
    const hash = createHash('sha256').update(`${externalId}:${status}`).digest('hex').slice(0, 32);
    return `erli-${hash}`;
  }

  /**
   * Case-insensitive header lookup. The host normally lowercases header names,
   * but Erli's exact casing on `Authorization` is not separately confirmed
   * (#1145 residual), so we match defensively regardless of casing.
   */
  private header(headers: Record<string, string>, name: string): string | null {
    const target = name.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === target) {
        return value;
      }
    }
    return null;
  }

  private nonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
}
