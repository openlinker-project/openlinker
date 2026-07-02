/**
 * Infakt Inbound Webhook Decoder Adapter (#1281, ADR-021)
 *
 * Authenticates + decodes Infakt's third-party-native webhooks at the host
 * ingress, keyed by `provider = 'infakt'`. Wraps the confirmed-live
 * `InfaktWebhookTranslator` (verify = HMAC-SHA256 hex over the raw body,
 * header `X-Infakt-Signature`; no timestamp header, so `verify` returns no
 * `timestampMs` and the shared replay-window check is a no-op for this
 * provider) rather than duplicating its crypto/parsing logic.
 *
 * `detectHandshake` covers Infakt's subscription-verification ping
 * (`{"verification_code": "..."}` → echo the same body back) — it runs
 * before `verify` per the port contract, since the ping predates any signed
 * traffic.
 *
 * @module libs/integrations/infakt/src/infrastructure/adapters
 */
import type {
  DecodeResult,
  InboundWebhookDecoderPort,
  WebhookVerifyResult,
} from '@openlinker/core/integrations';
import { Logger } from '@openlinker/shared/logging';
import { InfaktWebhookTranslator } from '../webhooks/infakt-webhook-translator';

const SIGNATURE_HEADER = 'X-Infakt-Signature';

export class InfaktInboundWebhookDecoderAdapter implements InboundWebhookDecoderPort {
  private readonly logger = new Logger(InfaktInboundWebhookDecoderAdapter.name);
  /** Secret-independent parsing helpers only — `verify` builds its own instance with the resolved per-connection secret. */
  private readonly parser = InfaktWebhookTranslator.forParsing(this.logger);

  detectHandshake(rawBody: Buffer): Record<string, unknown> | null {
    return this.parser.getVerificationEcho(rawBody);
  }

  verify(input: {
    rawBody: Buffer;
    headers: Record<string, string>;
    secret: string;
  }): WebhookVerifyResult {
    const signature = this.header(input.headers, SIGNATURE_HEADER);
    const translator = new InfaktWebhookTranslator({ secret: input.secret }, this.logger);
    return { ok: translator.verifySignature(input.rawBody, signature) };
  }

  extractEnvelope(rawBody: Buffer): DecodeResult {
    const parsed = this.parser.parse(rawBody);
    if (!parsed) {
      return { action: 'reject', reason: 'malformed Infakt webhook payload' };
    }

    // Short-circuit here rather than always routing: every Infakt event OL
    // doesn't act on (draft_invoice_created, invoice_marked_as_paid, …) would
    // otherwise still pay for a full Postgres dedup-insert + Redis publish
    // before being dead-lettered two hops later in WebhookToJobHandler.
    if (this.parser.toOlDomain(parsed.event.name) === null) {
      return { action: 'ignore', reason: `unhandled Infakt event: ${parsed.event.name}` };
    }

    const externalId =
      typeof parsed.resource['invoice_uuid'] === 'string'
        ? parsed.resource['invoice_uuid']
        : parsed.event.uuid;

    return {
      action: 'route',
      envelope: {
        eventId: parsed.event.uuid,
        eventType: parsed.event.name,
        occurredAt: parsed.event.created_at,
        objectType: 'invoice',
        externalId,
        payload: parsed.resource,
      },
    };
  }

  private header(headers: Record<string, string>, name: string): string | undefined {
    return headers[name] ?? headers[name.toLowerCase()];
  }
}
