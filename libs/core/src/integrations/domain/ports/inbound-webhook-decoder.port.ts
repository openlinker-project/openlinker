/**
 * Inbound Webhook Decoder Port
 *
 * Per-provider capability that authenticates a third-party-native inbound
 * webhook and decodes its raw body into the host's neutral inbound envelope
 * (ADR-021). It is the upstream complement to `WebhookEventTranslatorPort`
 * (ADR-015): the decoder runs **at the controller, before dedup/publish** (it
 * needs the raw bytes, the per-connection secret, and must derive the dedup
 * `eventId` pre-publish); the translator runs after publish on the neutral
 * event.
 *
 * Registered per `provider` (the `/webhooks/:provider/:connectionId` path
 * segment) in `InboundWebhookDecoderRegistryService`. OpenLinker's own HMAC +
 * `WebhookRequestDto` envelope is the registered host default decoder — third
 * parties (InPost, DPD) register their own scheme. Only signature-verified
 * payloads reach `extractEnvelope`.
 *
 * @module libs/core/src/integrations/domain/ports
 * @see {@link DecodeResult} for the three-state extract outcome
 */
import type {
  DecodeResult,
  WebhookVerifyResult,
} from '../types/inbound-webhook-decoder.types';

export interface InboundWebhookDecoderPort {
  /**
   * Verify the request's signature over the raw body, using the per-connection
   * shared secret. Returns `ok` plus the normalized (epoch-ms) timestamp the
   * host feeds to the shared replay-window check. A scheme without a shared
   * secret (e.g. cert-based) resolves its own material and may ignore `secret`.
   */
  verify(input: {
    rawBody: Buffer;
    headers: Record<string, string>;
    secret: string;
  }): WebhookVerifyResult;

  /**
   * Decode the (already signature-verified) raw body into the neutral
   * envelope, or signal `ignore` (well-formed, not ours) / `reject`
   * (malformed). Must be total — never throw unbounded.
   */
  extractEnvelope(rawBody: Buffer, headers: Record<string, string>): DecodeResult;
}
