/**
 * Infakt Webhook Translator — unit tests
 *
 * Verifies HMAC signature verification (valid/invalid/missing), the
 * verification-handshake echo, payload parsing, the `ksef_status` ->
 * canonical-domain mapping, and that an unknown event maps to `null`.
 *
 * @module libs/integrations/infakt/src/infrastructure/webhooks/__tests__
 */
import { createHmac } from 'crypto';
import type { LoggerPort } from '@openlinker/shared/logging';
import { InfaktWebhookTranslator } from '../infakt-webhook-translator';

const SECRET = 'test-webhook-secret';

function fakeLogger(): jest.Mocked<LoggerPort> {
  return { log: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

function sign(body: Buffer, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

describe('InfaktWebhookTranslator', () => {
  let logger: jest.Mocked<LoggerPort>;
  let translator: InfaktWebhookTranslator;

  beforeEach(() => {
    logger = fakeLogger();
    translator = new InfaktWebhookTranslator({ secret: SECRET }, logger);
  });

  describe('verifySignature', () => {
    it('should return true for a valid signature', () => {
      const body = Buffer.from(JSON.stringify({ event: { name: 'x' } }));
      expect(translator.verifySignature(body, sign(body, SECRET))).toBe(true);
    });

    it('should return false for an invalid signature', () => {
      const body = Buffer.from(JSON.stringify({ event: { name: 'x' } }));
      expect(translator.verifySignature(body, 'deadbeef')).toBe(false);
    });

    it('should return false when the signature header is missing', () => {
      const body = Buffer.from(JSON.stringify({ event: { name: 'x' } }));
      expect(translator.verifySignature(body, undefined)).toBe(false);
    });

    it('should return false for a signature signed with the wrong secret', () => {
      const body = Buffer.from(JSON.stringify({ event: { name: 'x' } }));
      expect(translator.verifySignature(body, sign(body, 'wrong-secret'))).toBe(false);
    });
  });

  describe('getVerificationEcho', () => {
    it('should echo the verification_code when present', () => {
      const body = Buffer.from(JSON.stringify({ verification_code: 'abc123' }));
      expect(translator.getVerificationEcho(body)).toEqual({ verification_code: 'abc123' });
    });

    it('should return null when the payload has no verification_code', () => {
      const body = Buffer.from(JSON.stringify({ event: { name: 'x' } }));
      expect(translator.getVerificationEcho(body)).toBeNull();
    });

    it('should return null when the payload is not valid JSON', () => {
      const body = Buffer.from('not json');
      expect(translator.getVerificationEcho(body)).toBeNull();
    });
  });

  describe('parse', () => {
    it('should parse a well-formed event payload', () => {
      const body = Buffer.from(
        JSON.stringify({
          event: { uuid: 'e-1', name: 'send_to_ksef_success', retry_counter: 0, created_at: 'now' },
          resource: { status: 'success', invoice_uuid: 'inv-1' },
        }),
      );
      const result = translator.parse(body);
      expect(result?.event.name).toBe('send_to_ksef_success');
      expect(result?.resource).toEqual({ status: 'success', invoice_uuid: 'inv-1' });
    });

    it('should return null and log a warning when the payload is missing the event field', () => {
      const body = Buffer.from(JSON.stringify({ resource: {} }));
      expect(translator.parse(body)).toBeNull();
      expect(logger.warn).toHaveBeenCalled();
    });

    it('should return null and log a warning when the payload is not valid JSON', () => {
      const body = Buffer.from('not json');
      expect(translator.parse(body)).toBeNull();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('toOlDomain', () => {
    it('should map send_to_ksef_success to invoicing', () => {
      expect(translator.toOlDomain('send_to_ksef_success')).toBe('invoicing');
    });

    it('should map send_to_ksef_error to invoicing', () => {
      expect(translator.toOlDomain('send_to_ksef_error')).toBe('invoicing');
    });

    it('should map an unknown event to null', () => {
      expect(translator.toOlDomain('some_future_event')).toBeNull();
    });

    it('should map draft_invoice_created to null (not a KSeF status event)', () => {
      expect(translator.toOlDomain('draft_invoice_created')).toBeNull();
    });
  });

  describe('toKsefResource', () => {
    it('should narrow a valid KSeF resource shape', () => {
      const resource = { status: 'success', invoice_uuid: 'inv-1', ksef_number: 'KSeF-1' };
      expect(translator.toKsefResource(resource)).toEqual(resource);
    });

    it('should return null when the resource is missing invoice_uuid', () => {
      expect(translator.toKsefResource({ status: 'success' })).toBeNull();
    });

    it('should return null when the resource is missing status', () => {
      expect(translator.toKsefResource({ invoice_uuid: 'inv-1' })).toBeNull();
    });
  });
});
