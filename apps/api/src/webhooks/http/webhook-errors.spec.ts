/**
 * Webhook ingress error codes (#3865)
 *
 * @module apps/api/src/webhooks/http
 */
import { PayloadTooLargeException, UnauthorizedException } from '@nestjs/common';
import { webhookPayloadTooLarge, webhookUnauthorized } from './webhook-errors';

describe('webhook errors (#3865)', () => {
  it('should keep the 401 class and carry the code', () => {
    const error = webhookUnauthorized('WEBHOOK_AUTHENTICATION_FAILED', 'Invalid signature', {
      provider: 'prestashop',
      connectionId: 'conn-1',
    });

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect(error.getResponse()).toEqual({
      statusCode: 401,
      code: 'WEBHOOK_AUTHENTICATION_FAILED',
      message: 'Invalid signature',
      params: { provider: 'prestashop', connectionId: 'conn-1' },
    });
  });

  it('should report both sizes on an oversized body', () => {
    const error = webhookPayloadTooLarge('too big', { maxBytes: 10, actualBytes: 12 });

    expect(error).toBeInstanceOf(PayloadTooLargeException);
    expect(error.getResponse()).toEqual(
      expect.objectContaining({
        statusCode: 413,
        code: 'WEBHOOK_PAYLOAD_TOO_LARGE',
        params: { maxBytes: 10, actualBytes: 12 },
      })
    );
  });
});
