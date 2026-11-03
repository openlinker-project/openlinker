import { createHmac } from 'node:crypto';

import { deriveShoperWebhookUrlToken } from '../shoper-webhook-url-token.policy';

const SECRET = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

describe('deriveShoperWebhookUrlToken', () => {
  it('should be HMAC-SHA256 of the v1 label keyed by the secret, in hex', () => {
    // Written out with the literal label rather than the exported constant, so
    // changing the label - which breaks every installed webhook URL - fails here.
    const expected = createHmac('sha256', SECRET).update('shoper-webhook-url-token:v1').digest('hex');

    expect(deriveShoperWebhookUrlToken(SECRET)).toBe(expected);
  });

  it('should be deterministic, so the decoder recomputes exactly what the provisioner wrote', () => {
    expect(deriveShoperWebhookUrlToken(SECRET)).toBe(deriveShoperWebhookUrlToken(SECRET));
  });

  it('should differ from the secret and never contain it', () => {
    const token = deriveShoperWebhookUrlToken(SECRET);

    expect(token).not.toBe(SECRET);
    expect(token).not.toContain(SECRET);
  });

  it('should differ per secret, so a rotation retires the old URL token', () => {
    expect(deriveShoperWebhookUrlToken(SECRET)).not.toBe(deriveShoperWebhookUrlToken(`${SECRET}x`));
  });

  it('should be 64 lower-case hex characters, safe in a URL without encoding', () => {
    expect(deriveShoperWebhookUrlToken('S3cr3t+/=value')).toMatch(/^[0-9a-f]{64}$/);
  });
});
