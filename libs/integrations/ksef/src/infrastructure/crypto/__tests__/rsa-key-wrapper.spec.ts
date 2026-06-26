/**
 * RSA-OAEP key wrapper round-trip + validation specs.
 *
 * Uses a self-generated RSA-2048 key pair to round-trip a wrapped AES key —
 * the production server holds the private half; here we hold both to assert the
 * OAEP/SHA-256 parameters match end-to-end.
 *
 * @module libs/integrations/ksef/src/infrastructure/crypto
 */
import { generateKeyPairSync, randomBytes } from 'crypto';
import { unwrapKeyWithRsa, wrapKeyWithRsa } from '../rsa-key-wrapper';
import { KsefSessionCryptoException } from '../../../domain/exceptions/ksef-session-crypto.exception';

describe('rsa-key-wrapper', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

  it('should round-trip a 32-byte AES key through wrap/unwrap', () => {
    const aesKey = new Uint8Array(randomBytes(32));
    const wrapped = wrapKeyWithRsa(aesKey, publicPem);
    expect(Array.from(unwrapKeyWithRsa(wrapped, privatePem))).toEqual(Array.from(aesKey));
  });

  it('should produce a wrapped key no larger than the RSA modulus (256 bytes for 2048-bit)', () => {
    const wrapped = wrapKeyWithRsa(new Uint8Array(randomBytes(32)), publicPem);
    expect(wrapped.byteLength).toBe(256);
  });

  it('should throw KsefSessionCryptoException for a malformed PEM', () => {
    expect(() => wrapKeyWithRsa(new Uint8Array(32), 'not a pem')).toThrow(KsefSessionCryptoException);
  });

  it('should reject an under-sized RSA key', () => {
    const small = generateKeyPairSync('rsa', { modulusLength: 1024 });
    const smallPem = small.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    expect(() => wrapKeyWithRsa(new Uint8Array(32), smallPem)).toThrow(KsefSessionCryptoException);
  });
});
