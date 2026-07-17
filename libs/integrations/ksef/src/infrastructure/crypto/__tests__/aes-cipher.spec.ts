/**
 * AES-256-CBC cipher round-trip + validation specs.
 *
 * @module libs/integrations/ksef/src/infrastructure/crypto
 */
import { randomBytes } from 'crypto';
import { decryptAesCbc, encryptAesCbc } from '../aes-cipher';
import { KSEF_AES_IV_BYTES, KSEF_AES_KEY_BYTES } from '../../http/ksef-crypto.constants';
import { KsefSessionCryptoException } from '../../../domain/exceptions/ksef-session-crypto.exception';

describe('aes-cipher', () => {
  const key = new Uint8Array(randomBytes(KSEF_AES_KEY_BYTES));
  const iv = new Uint8Array(randomBytes(KSEF_AES_IV_BYTES));

  it('should recover the exact plaintext byte-for-byte when round-tripping', () => {
    const plaintext = '<Faktura><NIP>1234567890</NIP></Faktura>';
    const ciphertext = encryptAesCbc(plaintext, key, iv);
    expect(decryptAesCbc(ciphertext, key, iv)).toBe(plaintext);
  });

  it('should round-trip a multi-byte UTF-8 plaintext without padding artifacts', () => {
    const plaintext = 'zażółć gęślą jaźń — €';
    expect(decryptAesCbc(encryptAesCbc(plaintext, key, iv), key, iv)).toBe(plaintext);
  });

  it('should throw KsefSessionCryptoException when the key length is wrong', () => {
    expect(() => encryptAesCbc('x', new Uint8Array(16), iv)).toThrow(KsefSessionCryptoException);
  });

  it('should throw KsefSessionCryptoException when the IV length is wrong', () => {
    expect(() => encryptAesCbc('x', key, new Uint8Array(8))).toThrow(KsefSessionCryptoException);
  });

  it('should never recover the plaintext when decrypting with the wrong key', () => {
    // CBC has no key verification: a wrong key usually fails PKCS#7 padding
    // validation (throws), but ~0.4% of random keys yield accidentally valid
    // padding and return garbage instead. Both outcomes are legal (#1538).
    const plaintext = 'secret';
    const ciphertext = encryptAesCbc(plaintext, key, iv);
    const wrongKey = new Uint8Array(randomBytes(KSEF_AES_KEY_BYTES));
    let result: string | undefined;
    try {
      result = decryptAesCbc(ciphertext, wrongKey, iv);
    } catch (err) {
      expect(err).toBeInstanceOf(KsefSessionCryptoException);
      return;
    }
    expect(result).not.toBe(plaintext);
  });

  it('should throw KsefSessionCryptoException when the ciphertext length is not a multiple of the block size', () => {
    // decipher.final() always throws on a truncated ciphertext, so this covers
    // the wrapping path of decryptAesCbc deterministically.
    const truncated = encryptAesCbc('secret', key, iv).slice(0, -1);
    expect(() => decryptAesCbc(truncated, key, iv)).toThrow(KsefSessionCryptoException);
  });
});
