/**
 * Default Webhook Decoder (#768, ADR-021)
 *
 * The host's fallback `InboundWebhookDecoderPort` for providers that register
 * no decoder of their own — i.e. OpenLinker's own modules (PrestaShop) that
 * post the OL-enveloped, OL-HMAC-signed webhook shape. It preserves the
 * pre-ADR-021 behaviour exactly: `verify` is the OL HMAC scheme
 * (`sha256=<hex>` over `{X-OpenLinker-Timestamp}.{rawBody}`); `extractEnvelope`
 * validates the body as `WebhookRequestDto` (same `class-validator` rules the
 * controller's `ValidationPipe` applied) and maps it to the neutral envelope.
 *
 * Registered by the webhooks module as the provider-agnostic default; a plugin
 * that registers a per-`provider` decoder (e.g. InPost) overrides it.
 *
 * @module apps/api/src/webhooks/application/decoders
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type {
  DecodeResult,
  InboundWebhookDecoderPort,
  WebhookVerifyResult,
} from '@openlinker/core/integrations';
import { WebhookRequestDto } from '../../http/dto/webhook-request.dto';

const TIMESTAMP_HEADER = 'x-openlinker-timestamp';
const SIGNATURE_HEADER = 'x-openlinker-signature';
const SIGNATURE_PREFIX = 'sha256=';

export class DefaultWebhookDecoder implements InboundWebhookDecoderPort {
  verify(input: {
    rawBody: Buffer;
    headers: Record<string, string>;
    secret: string;
  }): WebhookVerifyResult {
    const timestamp = this.header(input.headers, TIMESTAMP_HEADER);
    const signature = this.header(input.headers, SIGNATURE_HEADER);
    if (!timestamp || !signature || !signature.startsWith(SIGNATURE_PREFIX)) {
      return { ok: false };
    }
    const providedHex = signature.slice(SIGNATURE_PREFIX.length);
    if (!/^[0-9a-f]{64}$/i.test(providedHex)) {
      return { ok: false };
    }

    const signedPayload = Buffer.concat([
      Buffer.from(timestamp),
      Buffer.from('.'),
      input.rawBody,
    ]);
    const expectedHex = createHmac('sha256', input.secret).update(signedPayload).digest('hex');

    const provided = Buffer.from(providedHex, 'hex');
    const expected = Buffer.from(expectedHex, 'hex');
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      return { ok: false };
    }

    const timestampMs = Number.parseInt(timestamp, 10);
    return { ok: true, timestampMs: Number.isNaN(timestampMs) ? undefined : timestampMs };
  }

  extractEnvelope(rawBody: Buffer, _headers: Record<string, string>): DecodeResult {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return { action: 'reject', reason: 'body is not valid JSON' };
    }

    const dto = plainToInstance(WebhookRequestDto, parsed);
    const errors = validateSync(dto as object, {
      whitelist: true,
      forbidNonWhitelisted: false,
    });
    if (errors.length > 0) {
      return {
        action: 'reject',
        reason: `webhook envelope failed validation: ${errors
          .map((e) => e.property)
          .join(', ')}`,
      };
    }

    return {
      action: 'route',
      envelope: {
        eventId: dto.eventId,
        eventType: dto.eventType,
        occurredAt: dto.occurredAt,
        objectType: dto.object.type,
        externalId: dto.object.externalId,
        payload: dto.payload,
      },
    };
  }

  private header(headers: Record<string, string>, name: string): string | null {
    return headers[name] ?? headers[name.toLowerCase()] ?? null;
  }
}
