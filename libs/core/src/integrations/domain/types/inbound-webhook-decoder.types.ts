/**
 * Inbound Webhook Decoder Types
 *
 * Neutral types for the per-provider inbound-webhook decode seam (ADR-021).
 * A `InboundWebhookDecoderPort` authenticates a third-party-native webhook and
 * decodes its raw body into the host's neutral inbound envelope — the upstream
 * complement to the `WebhookEventTranslatorPort` (ADR-015), which runs after
 * publish to map the decoded event onto a `CanonicalInboundEvent`.
 *
 * `InboundWebhookEnvelope` is the subset of `InboundWebhookEvent` a decoder
 * derives from the raw body + headers; the host completes the `provider`,
 * `connectionId`, and `receivedAt` fields it owns.
 *
 * @module libs/core/src/integrations/domain/types
 * @see {@link InboundWebhookDecoderPort} for the port interface
 */
import type { InboundWebhookEvent } from '@openlinker/core/events';

/**
 * The decoder-derived portion of an inbound webhook event. The host owns and
 * fills `provider` (route param), `connectionId` (route param), and
 * `receivedAt` (ingest clock); the decoder supplies everything else from the
 * provider-native body — including `eventId` (the Postgres dedup key, derived
 * pre-dedup).
 */
export type InboundWebhookEnvelope = Omit<
  InboundWebhookEvent,
  'provider' | 'connectionId' | 'receivedAt'
>;

/**
 * Outcome of `extractEnvelope`. A discriminated union (plain `action`
 * discriminant, mirroring `RoutingOutcome.status`) — three states a
 * third-party-native stream needs that the OL-enveloped path never did:
 *
 * - `route`  — a well-formed event this connection should ingest → publish + 202.
 * - `ignore` — well-formed but not ours (unhandled topic, setup ping) → 202,
 *   no publish. Distinct from `reject` so benign third-party noise does not
 *   trigger source-side retry storms.
 * - `reject` — malformed / untrusted shape → 400.
 */
export type DecodeResult =
  | { action: 'route'; envelope: InboundWebhookEnvelope }
  | { action: 'ignore'; reason: string }
  | { action: 'reject'; reason: string };

/**
 * Outcome of `verify`. `timestampMs` is the normalized (epoch-ms) timestamp the
 * decoder extracted from the signed request, fed to the shared replay-window
 * check — so replay logic stays provider-agnostic regardless of the provider's
 * timestamp header name/format.
 */
export interface WebhookVerifyResult {
  ok: boolean;
  timestampMs?: number;
}
