/**
 * KSeF auth XML builder specs — envelope shape, escaping, deferred seal.
 *
 * @module libs/integrations/ksef/src/infrastructure/http/auth
 */
import { KsefAuthXmlBuilder } from '../ksef-auth-xml-builder';
import { KsefConfigException } from '../../../../domain/exceptions/ksef-config.exception';

describe('KsefAuthXmlBuilder', () => {
  const builder = new KsefAuthXmlBuilder();

  it('should build a well-formed unsigned AuthTokenRequest envelope', () => {
    const xml = builder.buildAuthTokenRequest({
      challenge: 'CH',
      contextNip: '1234567890',
      timestamp: '2026-06-23T12:00:00Z',
    });
    expect(xml).toContain('<AuthTokenRequest>');
    expect(xml).toContain('<Challenge>CH</Challenge>');
    expect(xml).toContain('<ContextNip>1234567890</ContextNip>');
    expect(xml).toContain('<Timestamp>2026-06-23T12:00:00Z</Timestamp>');
  });

  it('should escape XML-significant characters in interpolated values', () => {
    const xml = builder.buildAuthTokenRequest({
      challenge: 'a&b<c>"d\'',
      contextNip: '1',
      timestamp: 't',
    });
    expect(xml).toContain('a&amp;b&lt;c&gt;&quot;d&apos;');
    expect(xml).not.toMatch(/<Challenge>a&b/);
  });

  it('should throw for the deferred qualified-seal signing path', () => {
    expect(() => builder.signXades('<AuthTokenRequest/>')).toThrow(KsefConfigException);
  });
});
