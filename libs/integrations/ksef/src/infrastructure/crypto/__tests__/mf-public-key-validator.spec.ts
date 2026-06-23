/**
 * MF public-key certificate validator specs.
 *
 * @module libs/integrations/ksef/src/infrastructure/crypto
 */
import { validateMfPublicKeyCertificate } from '../mf-public-key-validator';
import type { PublicKeyCertificate } from '../../http/ksef-crypto.types';
import { KsefSessionCryptoException } from '../../../domain/exceptions/ksef-session-crypto.exception';

function cert(overrides: Partial<PublicKeyCertificate> = {}): PublicKeyCertificate {
  return {
    certificatePem: '-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----',
    usage: 'SymmetricKeyEncryption',
    validFrom: new Date('2026-01-01T00:00:00Z'),
    validUntil: new Date('2027-01-01T00:00:00Z'),
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
    const expired = cert({ validUntil: new Date('2026-05-01T00:00:00Z') });
    expect(() => validateMfPublicKeyCertificate(expired, 'SymmetricKeyEncryption', now)).toThrow(
      KsefSessionCryptoException,
    );
  });
});
