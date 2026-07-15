/**
 * Inbound-webhook signing helpers
 *
 * Reproduces, byte-for-byte, the OL-HMAC signature scheme an OpenLinker-module
 * provider (PrestaShop) uses when it POSTs to `/webhooks/:provider/:connectionId`
 * — the same scheme the host's `DefaultWebhookDecoder` verifies:
 *
 *   signature = "sha256=" + HMAC_SHA256(secret, `${timestampMs}.${rawBody}`)
 *   headers   = X-OpenLinker-Timestamp: <epoch ms>, X-OpenLinker-Signature: <sig>
 *
 * The body is the OL webhook envelope (`WebhookRequestDto` shape). Keeping the
 * signing here — off the API client — means the spec signs a request exactly as
 * the platform would, rather than trusting server-side code to sign for it.
 *
 * @module support
 */
import { createHmac, randomUUID } from 'node:crypto';

const SIGNATURE_HEADER = 'X-OpenLinker-Signature';
const TIMESTAMP_HEADER = 'X-OpenLinker-Timestamp';

/** The OL webhook envelope (mirrors the API's `WebhookRequestDto`). */
export interface WebhookEnvelope {
  schemaVersion: number;
  eventId: string;
  /** `category.action`, lowercase dot-separated (e.g. `order.created`). */
  eventType: string;
  /** ISO 8601 occurred-at. */
  occurredAt: string;
  object: { type: string; externalId: string };
  payload?: Record<string, unknown>;
}

/** A fully-signed request ready to hand to `api.webhooks.sendInbound`. */
export interface SignedWebhook {
  envelope: WebhookEnvelope;
  rawBody: string;
  headers: Record<string, string>;
  timestampMs: number;
}

export interface BuildWebhookOptions {
  /** Unique event id (`[A-Za-z0-9_-]+`). Defaults to a fresh UUID. */
  eventId?: string;
  eventType?: string;
  objectType?: string;
  externalId?: string;
  payload?: Record<string, unknown>;
  /** Override the epoch-ms timestamp (defaults to now). */
  timestampMs?: number;
}

/** Build a PrestaShop `order.created` envelope with unique, well-formed ids. */
export function buildOrderWebhookEnvelope(options: BuildWebhookOptions = {}): WebhookEnvelope {
  const eventId = options.eventId ?? `e2e-${randomUUID()}`;
  return {
    schemaVersion: 1,
    eventId,
    eventType: options.eventType ?? 'order.created',
    occurredAt: new Date().toISOString(),
    object: {
      type: options.objectType ?? 'order',
      // Synthetic id — the spec asserts the enqueue, not that the downstream
      // order-sync job resolves a real PrestaShop order.
      externalId: options.externalId ?? `e2e-order-${Date.now()}`,
    },
    payload: options.payload ?? { source: 'e2e-inbound-webhook-spec' },
  };
}

/**
 * Compute the OL-HMAC signature over `${timestampMs}.${rawBody}` and return the
 * `sha256=<hex>` header value.
 */
export function computeOlHmacSignature(
  secret: string,
  timestampMs: number,
  rawBody: string,
): string {
  const signedPayload = `${timestampMs}.${rawBody}`;
  const hex = createHmac('sha256', secret).update(signedPayload).digest('hex');
  return `sha256=${hex}`;
}

/**
 * Serialize + sign an envelope with the connection's webhook secret. The
 * returned `rawBody` is the exact string that was signed — send it verbatim
 * (re-serializing would change the bytes and break the signature).
 */
export function signWebhook(secret: string, envelope: WebhookEnvelope, timestampMs = Date.now()): SignedWebhook {
  const rawBody = JSON.stringify(envelope);
  const signature = computeOlHmacSignature(secret, timestampMs, rawBody);
  return {
    envelope,
    rawBody,
    timestampMs,
    headers: {
      [TIMESTAMP_HEADER]: String(timestampMs),
      [SIGNATURE_HEADER]: signature,
    },
  };
}
