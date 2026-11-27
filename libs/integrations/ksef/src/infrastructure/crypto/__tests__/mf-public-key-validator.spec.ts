/**
 * MF public-key certificate validator specs.
 *
 * @module libs/integrations/ksef/src/infrastructure/crypto
 */
import { X509Certificate } from 'crypto';
import { validateMfPublicKeyCertificate } from '../mf-public-key-validator';
import type { PublicKeyCertificate } from '../../http/ksef-crypto.types';
import type { CertificateRevocationChecker } from '../mf-certificate-trust.types';
import { KsefSessionCryptoException } from '../../../domain/exceptions/ksef-session-crypto.exception';
import { TEST_CA1_PEM, TEST_LEAF1_PEM, TEST_LEAF2_PEM } from './certificate-fixtures';

function cert(overrides: Partial<PublicKeyCertificate> = {}): PublicKeyCertificate {
  return {
    certificatePem: '-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----',
    usage: ['SymmetricKeyEncryption'],
    validFrom: new Date('2026-01-01T00:00:00Z'),
    validTo: new Date('2027-01-01T00:00:00Z'),
    certificateHash: 'abc123',
    ...overrides,
  };
}

describe('validateMfPublicKeyCertificate', () => {
  const now = new Date('2026-06-01T00:00:00Z');

  it('should pass for a valid in-window cert with matching usage', () => {
    expect(() => validateMfPublicKeyCertificate(cert(), 'SymmetricKeyEncryption', now)).not.toThrow();
  });

  it('should reject a usage mismatch', () => {
    expect(() => validateMfPublicKeyCertificate(cert(), 'KsefTokenEncryption', now)).toThrow(
      KsefSessionCryptoException,
    );
  });

  it('should reject a not-yet-valid cert', () => {
    const future = cert({ validFrom: new Date('2026-07-01T00:00:00Z') });
    expect(() => validateMfPublicKeyCertificate(future, 'SymmetricKeyEncryption', now)).toThrow(
      KsefSessionCryptoException,
    );
  });

  it('should reject an expired cert', () => {
    const expired = cert({ validTo: new Date('2026-05-01T00:00:00Z') });
    expect(() => validateMfPublicKeyCertificate(expired, 'SymmetricKeyEncryption', now)).toThrow(
      KsefSessionCryptoException,
    );
  });

  describe('chain-of-trust', () => {
    const anchors = [new X509Certificate(TEST_CA1_PEM)];

    it('should skip the chain check when no trust anchors are configured', () => {
      // certificatePem is the garbage default - would fail to parse if checked.
      expect(() =>
        validateMfPublicKeyCertificate(cert(), 'SymmetricKeyEncryption', now, { trustAnchors: [] }),
      ).not.toThrow();
    });

    it('should pass for a leaf that chains to a pinned trust anchor', () => {
      const trusted = cert({ certificatePem: TEST_LEAF1_PEM });
      expect(() =>
        validateMfPublicKeyCertificate(trusted, 'SymmetricKeyEncryption', now, {
          trustAnchors: anchors,
        }),
      ).not.toThrow();
    });

    it('should reject a leaf issued by an untrusted root', () => {
      const untrusted = cert({ certificatePem: TEST_LEAF2_PEM });
      expect(() =>
        validateMfPublicKeyCertificate(untrusted, 'SymmetricKeyEncryption', now, {
          trustAnchors: anchors,
        }),
      ).toThrow(KsefSessionCryptoException);
      try {
        validateMfPublicKeyCertificate(untrusted, 'SymmetricKeyEncryption', now, {
          trustAnchors: anchors,
        });
      } catch (error) {
        expect((error as KsefSessionCryptoException).errorCode).toBe('CERT_UNTRUSTED_ROOT');
      }
    });

    it('should reject an unparseable cert when anchors are configured', () => {
      expect(() =>
        validateMfPublicKeyCertificate(cert(), 'SymmetricKeyEncryption', now, {
          trustAnchors: anchors,
        }),
      ).toThrow(KsefSessionCryptoException);
    });
  });

  describe('revocation', () => {
    const anchors = [new X509Certificate(TEST_CA1_PEM)];
    const revoked: CertificateRevocationChecker = { check: () => 'revoked' };
    const good: CertificateRevocationChecker = { check: () => 'good' };
    const unknown: CertificateRevocationChecker = { check: () => 'unknown' };

    it('should reject a revoked cert', () => {
      const trusted = cert({ certificatePem: TEST_LEAF1_PEM });
      try {
        validateMfPublicKeyCertificate(trusted, 'SymmetricKeyEncryption', now, {
          trustAnchors: anchors,
          revocationChecker: revoked,
        });
        fail('expected a KsefSessionCryptoException');
      } catch (error) {
        expect(error).toBeInstanceOf(KsefSessionCryptoException);
        expect((error as KsefSessionCryptoException).errorCode).toBe('CERT_REVOKED');
      }
    });

    it('should pass a good cert', () => {
      const trusted = cert({ certificatePem: TEST_LEAF1_PEM });
      expect(() =>
        validateMfPublicKeyCertificate(trusted, 'SymmetricKeyEncryption', now, {
          trustAnchors: anchors,
          revocationChecker: good,
        }),
      ).not.toThrow();
    });

    it('should treat unknown revocation status as non-fatal', () => {
      const trusted = cert({ certificatePem: TEST_LEAF1_PEM });
      expect(() =>
        validateMfPublicKeyCertificate(trusted, 'SymmetricKeyEncryption', now, {
          trustAnchors: anchors,
          revocationChecker: unknown,
        }),
      ).not.toThrow();
    });
  });
});
