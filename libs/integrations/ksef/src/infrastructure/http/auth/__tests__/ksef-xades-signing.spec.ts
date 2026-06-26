/**
 * XAdES signing specs — the qualified-seal path with a generated self-signed
 * test cert.
 *
 * Two concerns are asserted here:
 *  1. The PRODUCTION `KsefAuthXmlBuilder.signXades` stays a loud deferred stub
 *     (qualified-seal signing lands in C4 with real X.509/HSM material).
 *  2. The TEST-only `signXadesForTest` fixture produces a verifiable enveloped
 *     signature over the unsigned AuthTokenRequest envelope using a generated
 *     RSA-2048 self-signed key pair — giving C4 a known-good reference shape and
 *     a round-trip (sign → verify) guarantee for the crypto, without shipping
 *     the deferred production signer.
 *
 * @module libs/integrations/ksef/src/infrastructure/http/auth
 */
import { KsefAuthXmlBuilder } from '../ksef-auth-xml-builder';
import { KsefConfigException } from '../../../../domain/exceptions/ksef-config.exception';
import {
  generateTestSigningMaterial,
  signXadesForTest,
  verifyXadesForTest,
  type TestSigningMaterial,
} from '../../../../testing/test-xades-signer';

describe('XAdES signing', () => {
  const builder = new KsefAuthXmlBuilder();
  let material: TestSigningMaterial;
  let unsignedXml: string;

  beforeAll(() => {
    material = generateTestSigningMaterial();
    unsignedXml = builder.buildAuthTokenRequest({
      challenge: 'CH-xades',
      contextNip: '1234567890',
      timestamp: '2026-06-23T12:00:00Z',
    });
  });

  describe('production signXades (deferred to C4)', () => {
    it('should throw KsefConfigException — the real qualified-seal path is not implemented', () => {
      expect(() => builder.signXades(unsignedXml)).toThrow(KsefConfigException);
    });
  });

  describe('test-only XAdES signer with a generated self-signed cert', () => {
    it('should sign the unsigned envelope and embed the signature + X.509 cert', () => {
      const signed = signXadesForTest(unsignedXml, material);

      // The inner unsigned envelope is preserved verbatim (enveloped signature).
      expect(signed).toContain('<AuthTokenRequest>');
      expect(signed).toContain('<Challenge>CH-xades</Challenge>');
      // The signature block + signer cert are embedded.
      expect(signed).toContain('<ds:SignatureValue>');
      expect(signed).toContain('<ds:X509Certificate>');
      expect(signed).toContain(material.certificateB64);
      expect(signed).toContain('rsa-sha256');
    });

    it('should produce a signature that verifies against the signer cert public key', () => {
      const signed = signXadesForTest(unsignedXml, material);
      expect(verifyXadesForTest(signed, unsignedXml, material)).toBe(true);
    });

    it('should fail verification when the signed envelope content is tampered', () => {
      const signed = signXadesForTest(unsignedXml, material);
      const tamperedUnsigned = unsignedXml.replace('1234567890', '9999999999');
      // Recomputing the digest over different content must not match the
      // signature minted over the original envelope.
      expect(verifyXadesForTest(signed, tamperedUnsigned, material)).toBe(false);
    });

    it('should fail verification under a different key pair (wrong signer)', () => {
      const signed = signXadesForTest(unsignedXml, material);
      const otherMaterial = generateTestSigningMaterial();
      expect(verifyXadesForTest(signed, unsignedXml, otherMaterial)).toBe(false);
    });

    it('should return false when no SignatureValue is present', () => {
      expect(verifyXadesForTest('<no-signature/>', unsignedXml, material)).toBe(false);
    });
  });
});
