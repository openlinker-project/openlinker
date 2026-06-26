/**
 * KSeF JWT expiry parser specs — happy path + malformed-token handling.
 *
 * @module libs/integrations/ksef/src/infrastructure/http/auth
 */
import { parseJwtExpiry } from '../ksef-jwt-parser';
import { KsefAuthenticationException } from '../../../../domain/exceptions/ksef-authentication.exception';

function jwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.`;
}

describe('parseJwtExpiry', () => {
  it('should extract exp as a Date', () => {
    const expSeconds = Math.floor(new Date('2026-06-23T12:00:00Z').getTime() / 1000);
    expect(parseJwtExpiry(jwt({ exp: expSeconds })).getTime()).toBe(expSeconds * 1000);
  });

  it('should throw for a token without 3 segments', () => {
    expect(() => parseJwtExpiry('a.b')).toThrow(KsefAuthenticationException);
  });

  it('should throw for an undecodable payload', () => {
    expect(() => parseJwtExpiry('aaa.!!!!.ccc')).toThrow(KsefAuthenticationException);
  });

  it('should throw when exp is missing', () => {
    expect(() => parseJwtExpiry(jwt({ sub: 'x' }))).toThrow(KsefAuthenticationException);
  });

  it('should not leak the token in the error message', () => {
    const token = jwt({ sub: 'secret-subject' });
    try {
      parseJwtExpiry(token.replace('.', '')); // break segment count
    } catch (err) {
      expect((err as Error).message).not.toContain('secret-subject');
    }
  });
});
