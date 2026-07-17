/**
 * InPost Inbound Webhook Decoder Adapter (#768, ADR-021)
 *
 * Authenticates + decodes InPost ShipX `Shipment.Tracking` webhooks at the host
 * ingress, keyed by `provider = 'inpost'`. The verify half implements InPost's
 * HMAC scheme (base64 HMAC-SHA256, header `x-inpost-signature`) using the shared
 * secret OL generates and hands InPost, resolved by the host via
 * `WebhookSecretProviderPort`. The extract half is a pure transform into the
 * host's neutral envelope.
 *
 * Signature scheme (#1556) — per InPost's "Webhook Signature Verification" docs
 * (https://developers.inpost-group.com/webhook-signature-verification):
 *
 *   "The calculated signature will be transformed from byte[] to Base64 and then
 *    placed in the x-inpost-signature header."
 *   "Payload to sign can be created in two ways which also can be configurable
 *    per client: concatenated request timestamp header (x-inpost-timestamp) and
 *    event payload ("." - dot sign will be a separator)."
 *
 * The signed content is therefore NOT one fixed form: InPost's integration team
 * configures it per client (their Example 1 = body only, Example 2 =
 * `{x-inpost-timestamp}.{body}`), and OL neither controls nor is told the
 * choice. So we accept EITHER, and are correct under both configurations rather
 * than betting on one and rejecting 100% of deliveries if the bet is wrong.
 *
 * Trying both is not a downgrade: forging a body-only signature still requires
 * the secret, so the fallback only succeeds when InPost genuinely signed
 * body-only. Replaying a captured `{ts}.{body}` delivery under a different
 * timestamp matches neither candidate. The one asymmetry is inherent to InPost's
 * body-only variant, not introduced here — it leaves the timestamp unsigned, so
 * a replay could slip the host's window; the durable `(provider, connectionId,
 * eventId)` dedup gate (#711) collapses it, and under ADR-021 the worst case is
 * a redundant idempotent re-read, never wrong state.
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
const EVENT_ID_HEADER = 'x-inpost-event-id';
const TRACKING_TOPIC = 'Shipment.Tracking';

/**
 * ShipX renders `event_ts` as `"2020-03-20 15:08:42 +0100"` — a space-separated,
 * non-ISO-8601 form (docs: "[1.23.0] Webhooks"). The neutral envelope's
 * `occurredAt` is contractually an ISO-8601 string, so that form is normalized
 * rather than passed through verbatim (#1556). Anything already ISO-8601 (the
 * `x-inpost-timestamp` header, and InPost's newer payloads) skips this path.
 */
const SHIPX_EVENT_TS_PATTERN = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?) ([+-]\d{2}):?(\d{2})$/;

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
    if (!signature) {
      return { ok: false };
    }
    const timestamp = this.header(input.headers, TIMESTAMP_HEADER);

    // Candidate signed contents, in InPost's documented order. Without the
    // timestamp header only the body-only form is expressible — that delivery is
    // still authentic under body-only signing, so it must not be rejected out of
    // hand (rejecting it was the second silent-death mode behind #1556).
    const candidates: Buffer[] = timestamp
      ? [Buffer.concat([Buffer.from(timestamp), Buffer.from('.'), input.rawBody]), input.rawBody]
      : [input.rawBody];

    // reduce(), not some()/early-return: every candidate is compared so the work
    // done does not vary with which variant matched.
    const matched = candidates.reduce(
      (acc, candidate) => this.signatureMatches(candidate, input.secret, signature) || acc,
      false,
    );
    if (!matched) {
      return { ok: false };
    }

    if (!timestamp) {
      // No signed timestamp to replay-check against. The host skips its
      // replay window when `timestampMs` is absent; the durable eventId dedup
      // gate stays the backstop (same posture as the WooCommerce decoder).
      return { ok: true };
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

    // Prefer the signed `x-inpost-timestamp` header (already ISO-8601); fall
    // back to the body's `event_ts`, normalized from ShipX's non-ISO form.
    // Reject rather than fabricate a timestamp, keeping this a pure transform.
    const rawOccurredAt =
      this.header(headers, TIMESTAMP_HEADER) ?? this.firstString(record, [['event_ts']]);
    if (!rawOccurredAt) {
      return { action: 'reject', reason: 'missing event timestamp' };
    }
    const occurredAt = this.toIsoTimestamp(rawOccurredAt);
    return {
      action: 'route',
      envelope: {
        // Dedup key — use a provider event id if present, else a deterministic
        // hash of the shipment id + event timestamp so retries collapse and
        // distinct events don't. Best-effort (the idempotent re-read is the
        // correctness guarantee), so the eventId need only suppress obvious dupes.
        eventId: this.deriveEventId(record, headers, shipmentId, occurredAt),
        eventType: 'tracking',
        occurredAt,
        objectType: 'shipment',
        externalId: shipmentId,
      },
    };
  }

  /**
   * Timing-safe base64 HMAC-SHA256 comparison of one candidate signed content
   * against the provided `x-inpost-signature` value.
   */
  private signatureMatches(signedContent: Buffer, secret: string, signature: string): boolean {
    const expected = createHmac('sha256', secret).update(signedContent).digest('base64');
    const provided = Buffer.from(signature);
    const expectedBuf = Buffer.from(expected);
    // Length must match before timingSafeEqual, which throws on unequal lengths.
    return provided.length === expectedBuf.length && timingSafeEqual(provided, expectedBuf);
  }

  /**
   * Normalize a ShipX `event_ts` (`"2020-03-20 15:08:42 +0100"`) into ISO-8601,
   * preserving the instant and its UTC offset. Values that don't match that
   * exact documented form — including anything already ISO-8601 — pass through
   * untouched, so this never mangles a shape we haven't seen.
   */
  private toIsoTimestamp(value: string): string {
    const match = SHIPX_EVENT_TS_PATTERN.exec(value);
    if (!match) {
      return value;
    }
    const [, date, time, offsetHours, offsetMinutes] = match;
    const candidate = `${date}T${time}${offsetHours}:${offsetMinutes}`;
    return Number.isNaN(Date.parse(candidate)) ? value : candidate;
  }

  private deriveEventId(
    record: Record<string, unknown>,
    headers: Record<string, string>,
    shipmentId: string,
    occurredAt: string | undefined,
  ): string {
    // InPost's own event id, documented as the "Unique id of the event" — the
    // authoritative dedup basis, so it outranks body fields and the hash (#1556).
    const headerEventId = this.header(headers, EVENT_ID_HEADER);
    if (headerEventId) {
      return headerEventId;
    }
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

  /**
   * Walk a key path over the parsed body, returning the leaf value or
   * `undefined` if any segment is missing or non-traversable. Shared traversal
   * backing the `firstString` / `firstIdentifier` accessors.
   */
  private resolvePath(record: Record<string, unknown>, path: readonly string[]): unknown {
    let cursor: unknown = record;
    for (const key of path) {
      if (typeof cursor !== 'object' || cursor === null) {
        return undefined;
      }
      cursor = (cursor as Record<string, unknown>)[key];
    }
    return cursor;
  }

  private firstString(
    record: Record<string, unknown>,
    paths: readonly string[][],
  ): string | null {
    for (const path of paths) {
      const cursor = this.resolvePath(record, path);
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
      const cursor = this.resolvePath(record, path);
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
