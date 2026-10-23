/**
 * The shared auth-refusal reader (#3365 review).
 *
 * The load-bearing case is the redaction: the body comes from a service
 * OpenLinker does not control, so a bridge that echoes its own token back in a
 * 401 must not have that token end up in an error message, a log line or an
 * operator's screenshot.
 */
import { readBridgeAuthReason, redactBridgeToken } from '../subiekt-auth-reason';

function response(body: string, status = 401): Response {
  return new Response(body, { status });
}

describe('redactBridgeToken', () => {
  it('should remove the token verbatim', () => {
    expect(redactBridgeToken('bad token: s3cr3t-token-value', 's3cr3t-token-value')).toBe(
      'bad token: [redacted]'
    );
  });

  it('should remove a percent-encoded copy and ignore case', () => {
    const token = 'tok en+value';
    const echoed = `challenge=${encodeURIComponent(token)}`;
    expect(redactBridgeToken(echoed, token)).toBe('challenge=[redacted]');
    expect(redactBridgeToken('S3CR3T-TOKEN-VALUE', 's3cr3t-token-value')).toBe('[redacted]');
  });

  it('should leave a very short token alone rather than shredding the sentence', () => {
    // Redacting a two-character secret turns the bridge's own message into
    // noise, and the redaction becomes the thing that made it unreadable.
    expect(redactBridgeToken('the bridge said no', 'no')).toBe('the bridge said no');
  });

  it('should treat a regex metacharacter in the token as a literal', () => {
    expect(redactBridgeToken('saw a.b+c*d?e', 'a.b+c*d?e')).toBe('saw [redacted]');
  });

  it('should bound the excerpt', () => {
    const long = 'x'.repeat(400);
    const out = redactBridgeToken(long, undefined);
    expect(out.length).toBeLessThanOrEqual(301);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('readBridgeAuthReason', () => {
  it('should read an enveloped reason', async () => {
    await expect(
      readBridgeAuthReason(response('{"error":{"reason":"token expired"}}'), undefined)
    ).resolves.toBe('token expired');
  });

  it('should read a bare reason', async () => {
    await expect(readBridgeAuthReason(response('{"reason":"nope"}'), undefined)).resolves.toBe(
      'nope'
    );
  });

  it('should surface non-JSON text, which is what a proxy in front of the bridge sends', async () => {
    await expect(readBridgeAuthReason(response('<html>403 Forbidden</html>'), undefined)).resolves.toBe(
      '<html>403 Forbidden</html>'
    );
  });

  it('should answer undefined for an empty body rather than an empty string', async () => {
    await expect(readBridgeAuthReason(response(''), undefined)).resolves.toBeUndefined();
  });

  it('should answer undefined when the body only repeats the status', async () => {
    await expect(readBridgeAuthReason(response('HTTP 401'), undefined)).resolves.toBeUndefined();
  });

  it('should redact a token the bridge echoed back', async () => {
    await expect(
      readBridgeAuthReason(response('{"reason":"bad token s3cr3t-token-value"}'), 's3cr3t-token-value')
    ).resolves.toBe('bad token [redacted]');
  });
});
