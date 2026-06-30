/**
 * Infakt Webhook Translator
 *
 * Translates inbound Infakt webhook payloads to canonical OL events.
 *
 * Infakt webhook facts (confirmed 2026-06-30):
 *  - Subscriptions are configured only via the Infakt web UI — no REST API.
 *  - Every delivery carries X-Infakt-Signature = HMAC-SHA256(rawBody, secret).
 *  - Known event: `invoice_processed_in_ksef` (clearance status changed).
 *
 * Payload shape:
 *   { event: { uuid, name, retry_counter, created_at }, resource: <invoice> }
 *
 * @module libs/integrations/infakt/src/infrastructure/webhooks
 */
import { createHmac, timingSafeEqual } from 'crypto';
import type { LoggerPort } from '@openlinker/shared/logging';

export interface InfaktWebhookEvent {
  event: {
    uuid: string;
    name: string;
    retry_counter: number;
    created_at: string;
  };
  resource: Record<string, unknown>;
}

export type InfaktWebhookEventName =
  | 'invoice_processed_in_ksef'
  | string; // open — Infakt may add new events

export interface InfaktWebhookTranslatorConfig {
  /** HMAC-SHA256 secret from Infakt webhook settings (UI-generated, per-subscription). */
  secret: string;
}

export class InfaktWebhookTranslator {
  constructor(
    private readonly config: InfaktWebhookTranslatorConfig,
    private readonly logger: LoggerPort,
  ) {}

  /**
   * Verifies the X-Infakt-Signature header against the raw request body.
   * Returns false if the signature is missing, malformed, or invalid.
   * Callers should respond HTTP 401 on false.
   */
  verifySignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
    if (!signatureHeader) return false;
    try {
      const expected = createHmac('sha256', this.config.secret)
        .update(rawBody)
        .digest('hex');
      const expectedBuf = Buffer.from(expected);
      const actualBuf = Buffer.from(signatureHeader);
      if (expectedBuf.length !== actualBuf.length) return false;
      return timingSafeEqual(expectedBuf, actualBuf);
    } catch {
      return false;
    }
  }

  /**
   * Parses and validates the webhook payload JSON.
   * Returns null if the payload is malformed or missing required fields.
   */
  parse(rawBody: Buffer): InfaktWebhookEvent | null {
    try {
      const payload = JSON.parse(rawBody.toString('utf-8')) as unknown;
      if (
        typeof payload !== 'object' ||
        payload === null ||
        !('event' in payload) ||
        typeof (payload as Record<string, unknown>)['event'] !== 'object'
      ) {
        this.logger.warn('Infakt webhook: malformed payload (missing event field)');
        return null;
      }
      return payload as InfaktWebhookEvent;
    } catch {
      this.logger.warn('Infakt webhook: payload is not valid JSON');
      return null;
    }
  }

  /**
   * Maps an Infakt event name to the OL canonical domain.
   * Returns null for events OL does not handle (should ACK with 200 and ignore).
   */
  toOlDomain(eventName: InfaktWebhookEventName): 'invoicing' | null {
    switch (eventName) {
      case 'invoice_processed_in_ksef':
        return 'invoicing';
      default:
        return null;
    }
  }
}
