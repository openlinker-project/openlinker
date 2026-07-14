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
 * of truth. We read ONLY the shipment identifier from the body — never InPost's
 * status enum — and route a shipment-targeted refresh that re-reads
 * authoritative status via `getTracking`. So an imperfect payload degrades to a
 * redundant re-read, never wrong state.
 *
 * Payload shape (ShipX Webhooks, docs page "[1.23.0] Webhooks"): a status event
 * is `{ event_ts, event, organization_id, payload: { shipment_id, status,
 * tracking_number } }` where `event` is `shipment_status_changed` /
 * `shipment_confirmed` (and `offers_prepared`, which we ignore). The refresh
 * re-reads `GET /v1/shipments/{id}`, so the identifier we extract MUST be the
 * ShipX `shipment_id` (== the `providerShipmentId` OL persists), NOT the
 * `tracking_number` (which is nested, frequently `null` early in the lifecycle,
 * and would 404 against the by-id resource). The `x-inpost-*` header form is
 * kept as a forward-compat fallback but the body `event` field is authoritative.
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
 * ShipX `event` values that signify a shipment status change worth refreshing.
 * `offers_prepared` and any other event fall through to ack-and-ignore.
 */
const TRACKING_EVENTS: readonly string[] = ['shipment_status_changed', 'shipment_confirmed'];

/**
 * Candidate body paths carrying the shipment identifier, tried in order. The
 * authoritative ShipX shape nests it at `payload.shipment_id` (a number); this
 * is the id the downstream refresh re-reads (`GET /v1/shipments/{id}`), so it
 * ranks first. The remaining `tracking_number` paths are last-resort fallbacks
 * for shape-robustness only — they are NOT the refresh key and are kept so a
 * malformed/legacy payload still routes (a wrong-id re-read 404s and the 30-min
 * poll heals it, never wrong state).
 */
const SHIPMENT_ID_CANDIDATE_PATHS: readonly string[][] = [
  ['payload', 'shipment_id'],
  ['shipment_id'],
  ['payload', 'tracking_number'],
  ['shipment', 'tracking_number'],
  ['tracking_number'],
  ['trackingNumber'],
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
    const headerTopic = this.header(headers, TOPIC_HEADER);
    if (headerTopic && headerTopic !== TRACKING_TOPIC) {
      // A different header topic (setup ping / non-tracking topic) — ack-and-
      // ignore, don't 400 (avoids InPost retry storms on topics we don't route).
      return { action: 'ignore', reason: `unhandled topic: ${headerTopic}` };
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

    // Event classification: the authoritative signal is the body `event` field
    // (ShipX Webhooks); the `x-inpost-topic` header is a forward-compat fallback.
    const eventName = headerTopic ?? this.firstString(record, [['event']]);
    const isTrackingEvent =
      eventName === TRACKING_TOPIC || (eventName !== null && TRACKING_EVENTS.includes(eventName));
    if (!isTrackingEvent) {
      return { action: 'ignore', reason: `unhandled event: ${eventName ?? '(none)'}` };
    }

    const shipmentId = this.firstIdentifier(record, SHIPMENT_ID_CANDIDATE_PATHS);
    if (!shipmentId) {
      return { action: 'reject', reason: 'no shipment identifier in payload' };
    }

    // Prefer the signed `x-inpost-timestamp` header; fall back to the body's
    // `event_ts` (present in the ShipX payload). Reject rather than fabricate a
    // timestamp, keeping this a pure transform.
    const occurredAt =
      this.header(headers, TIMESTAMP_HEADER) ?? this.firstString(record, [['event_ts']]);
    if (!occurredAt) {
      return { action: 'reject', reason: 'missing event timestamp' };
    }
    return {
      action: 'route',
      envelope: {
        // Dedup key — use a provider event id if present, else a deterministic
        // hash of the shipment id + event timestamp so retries collapse and
        // distinct events don't. Best-effort (the idempotent re-read is the
        // correctness guarantee), so the eventId need only suppress obvious dupes.
        eventId: this.deriveEventId(record, shipmentId, occurredAt),
        eventType: 'tracking',
        occurredAt,
        objectType: 'shipment',
        externalId: shipmentId,
      },
    };
  }

  private deriveEventId(
    record: Record<string, unknown>,
    shipmentId: string,
    occurredAt: string | undefined,
  ): string {
    const explicit = this.firstString(record, [['event_id'], ['eventId'], ['id']]);
    if (explicit) {
      return explicit;
    }
    const basis = `${shipmentId}:${occurredAt ?? ''}`;
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

  /**
   * Like `firstString` but also accepts a finite number (ShipX sends
   * `shipment_id` as a JSON number), coercing it to its string form.
   */
  private firstIdentifier(
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
      if (typeof cursor === 'number' && Number.isFinite(cursor)) {
        return String(cursor);
      }
    }
    return null;
  }
}
