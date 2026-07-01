/**
 * Infakt Webhook Translator
 *
 * Translates inbound Infakt webhook payloads to canonical OL events.
 *
 * Infakt webhook facts (confirmed live 2026-06-30 on sandbox):
 *  - Subscriptions configured via Infakt web UI only — no REST API.
 *  - Verification flow: Infakt POSTs {"verification_code":"<random>"} → endpoint
 *    must echo {"verification_code":"<same>"} back → webhook becomes active.
 *  - Every delivery carries X-Infakt-Signature = HMAC-SHA256(rawBody, secret).
 *    Secret is auto-generated per subscription, visible in webhook details UI.
 *    Return 401 on bad signature.
 *  - User-Agent: Infakt-Webhooks/2
 *
 * Confirmed live event names (sandbox, 2026-06-30):
 *   draft_invoice_created   — "Faktura utworzona (szkic)"
 *   send_to_ksef_success    — "Faktura wysłana do KSEF"     ← key for OL clearance update
 *   send_to_ksef_error      — "Błąd wysyłki faktury do KSEF" (inferred)
 *
 * Payload shape:
 *   { event: { uuid, name, retry_counter, created_at }, resource: <see below> }
 *
 * Resource shape for send_to_ksef_success (confirmed):
 *   { status, ksef_number, invoice_uuid, invoice_kind, request_uuid,
 *     status_description, timestamps: { request_created_at, request_finished_at } }
 *
 * Resource shape for draft_invoice_created (confirmed):
 *   full invoice object (same as GET /invoices/{uuid}.json)
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

/** Resource shape for send_to_ksef_success / send_to_ksef_error (confirmed live). */
export interface InfaktKsefWebhookResource {
  status: 'success' | 'error';
  ksef_number: string | null;
  invoice_uuid: string;
  invoice_kind: string;
  request_uuid: string;
  status_description: string | null;
  timestamps: {
    request_created_at: string;
    request_finished_at: string;
  };
}

/**
 * Confirmed live event names (documented for readers; NOT a closed union —
 * Infakt may add new events, so the runtime type is a bare `string`. Listing
 * literals alongside `string` in the same union is redundant per
 * `@typescript-eslint/no-redundant-type-constituents` (the literals widen to
 * `string` at the type level), so the well-known values live here as
 * documentation only, mirroring the `PromptTemplateChannel = string` /
 * `CoreCapability` open-world precedent:
 *   - `draft_invoice_created`
 *   - `send_to_ksef_success`
 *   - `send_to_ksef_error`
 *   - `invoice_created_via_async_api`
 *   - `invoice_creation_error_via_async_api`
 *   - `invoice_marked_as_paid_via_async_api`
 *   - `invoice_marking_as_paid_error_via_async_api`
 *   - `invoice_deleted`
 *   - `invoice_marked_as_paid`
 * Additional events beyond this list are available in the Infakt UI but not
 * yet confirmed in this POC.
 */
export type InfaktWebhookEventName = string;

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
   * Returns the verification_code echo body when Infakt sends a verification ping.
   * The OL webhook controller must respond with this JSON body to activate the webhook.
   * Returns null if the payload is not a verification ping.
   */
  getVerificationEcho(rawBody: Buffer): { verification_code: string } | null {
    try {
      const parsed = JSON.parse(rawBody.toString('utf-8')) as unknown;
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'verification_code' in parsed &&
        typeof (parsed as Record<string, unknown>)['verification_code'] === 'string'
      ) {
        return { verification_code: (parsed as { verification_code: string }).verification_code };
      }
    } catch {
      // not JSON
    }
    return null;
  }

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
   * Returns null for events OL does not handle (ACK with 200 and ignore).
   */
  toOlDomain(eventName: InfaktWebhookEventName): 'invoicing' | null {
    switch (eventName) {
      case 'send_to_ksef_success':
      case 'send_to_ksef_error':
        return 'invoicing';
      default:
        return null;
    }
  }

  /**
   * Narrows resource to InfaktKsefWebhookResource for KSeF events.
   * Returns null if the resource doesn't match the expected shape.
   */
  toKsefResource(resource: Record<string, unknown>): InfaktKsefWebhookResource | null {
    if (
      typeof resource['invoice_uuid'] === 'string' &&
      typeof resource['status'] === 'string'
    ) {
      return resource as unknown as InfaktKsefWebhookResource;
    }
    return null;
  }
}
