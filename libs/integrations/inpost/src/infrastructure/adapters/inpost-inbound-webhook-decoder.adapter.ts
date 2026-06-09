/**
 * InPost Inbound Webhook Decoder Adapter (#768, ADR-021)
 *
 * Authenticates + decodes InPost ShipX `Shipment.Tracking` webhooks at the host
 * ingress, keyed by `provider = 'inpost'`. The verify half uses InPost's HMAC
 * scheme (base64 HMAC-SHA256 over `{x-inpost-timestamp}.{rawBody}`, header
 * `x-inpost-signature`) — the shared secret OL generates and hands InPost,
 * resolved by the host via `WebhookSecretProviderPort`. The extract half is a
 * pure transform into the host's neutral envelope.
 *
 * Trigger model (ADR-021): the webhook is a low-latency nudge, never the source
 * of truth. We read ONLY the parcel identifier from the body — never InPost's
 * status enum (sandbox-gated catalogue, OQ-B3) — and route a parcel-targeted
 * refresh that re-reads authoritative status via `getTracking`. So an imperfect
 * payload degrades to a redundant re-read, never wrong state.
 *
 * @module libs/integrations/inpost/src/infrastructure/adapters
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type {
  DecodeResult,
  InboundWebhookDecoderPort,
  WebhookVerifyResult,
} from '@openlinker/core/integrations';

const SIGNATURE_HEADER = 'x-inpost-signature';
const TIMESTAMP_HEADER = 'x-inpost-timestamp';
const TOPIC_HEADER = 'x-inpost-topic';
const TRACKING_TOPIC = 'Shipment.Tracking';

/**
 * Candidate body fields carrying the parcel identifier, tried in order. InPost's
 * exact `Shipment.Tracking` payload shape is not public (OQ-B3) — these are the
 * documented-best-guess keys; the live field is confirmed during sandbox
 * onboarding. Isolated here so confirming it is a one-line change, and because
 * the re-read (not the payload) is authoritative the blast radius is a redundant
 * `getTracking`, not incorrect state.
 */
const PARCEL_ID_CANDIDATE_PATHS: readonly string[][] = [
  ['tracking_number'],
  ['trackingNumber'],
  ['shipment', 'tracking_number'],
  ['payload', 'tracking_number'],
];

export class InpostInboundWebhookDecoderAdapter implements InboundWebhookDecoderPort {
  verify(input: {
    rawBody: Buffer;
    headers: Record<string, string>;
    secret: string;
  }): WebhookVerifyResult {
    const signature = this.header(input.headers, SIGNATURE_HEADER);
    const timestamp = this.header(input.headers, TIMESTAMP_HEADER);
    if (!signature || !timestamp) {
      return { ok: false };
    }

    const signedPayload = Buffer.concat([
      Buffer.from(timestamp),
      Buffer.from('.'),
      input.rawBody,
    ]);
    const expected = createHmac('sha256', input.secret).update(signedPayload).digest('base64');

    const provided = Buffer.from(signature);
    const expectedBuf = Buffer.from(expected);
    if (provided.length !== expectedBuf.length || !timingSafeEqual(provided, expectedBuf)) {
      return { ok: false };
    }

    // InPost stamps an ISO-8601 timestamp (e.g. "2025-01-08T14:03:55.387Z"); the
    // host replay-window check runs on the normalized epoch-ms we return.
    const timestampMs = Date.parse(timestamp);
    return { ok: true, timestampMs: Number.isNaN(timestampMs) ? undefined : timestampMs };
  }

  extractEnvelope(rawBody: Buffer, headers: Record<string, string>): DecodeResult {
    const topic = this.header(headers, TOPIC_HEADER);
    if (topic !== TRACKING_TOPIC) {
      // Well-formed but not a tracking event (other topic / setup ping) —
      // ack-and-ignore, don't 400 (avoids InPost retry storms on topics we
      // don't route).
      return { action: 'ignore', reason: `unhandled topic: ${topic ?? '(none)'}` };
    }

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
    const parcelId = this.firstString(record, PARCEL_ID_CANDIDATE_PATHS);
    if (!parcelId) {
      return { action: 'reject', reason: 'no parcel identifier in payload' };
    }

    // A verified request always carries `x-inpost-timestamp` (it's inside the
    // signed payload); fall back to now only for the type system's benefit.
    const occurredAt = this.header(headers, TIMESTAMP_HEADER) ?? new Date().toISOString();
    return {
      action: 'route',
      envelope: {
        // Dedup key — use a provider event id if present, else a deterministic
        // hash of the parcel id + event timestamp so retries collapse and
        // distinct events don't. Best-effort (the idempotent re-read is the
        // correctness guarantee), so the eventId need only suppress obvious dupes.
        eventId: this.deriveEventId(record, parcelId, occurredAt),
        eventType: 'tracking',
        occurredAt,
        objectType: 'shipment',
        externalId: parcelId,
      },
    };
  }

  private deriveEventId(
    record: Record<string, unknown>,
    parcelId: string,
    occurredAt: string | undefined,
  ): string {
    const explicit = this.firstString(record, [['event_id'], ['eventId'], ['id']]);
    if (explicit) {
      return explicit;
    }
    const basis = `${parcelId}:${occurredAt ?? ''}`;
    return `inpost-${createHash('sha256').update(basis).digest('hex').slice(0, 32)}`;
  }

  private header(headers: Record<string, string>, name: string): string | null {
    return headers[name] ?? headers[name.toLowerCase()] ?? null;
  }

  private firstString(
    record: Record<string, unknown>,
    paths: readonly string[][],
  ): string | null {
    for (const path of paths) {
      let cursor: unknown = record;
      for (const key of path) {
        if (typeof cursor !== 'object' || cursor === null) {
          cursor = undefined;
          break;
        }
        cursor = (cursor as Record<string, unknown>)[key];
      }
      if (typeof cursor === 'string' && cursor.length > 0) {
        return cursor;
      }
    }
    return null;
  }
}
