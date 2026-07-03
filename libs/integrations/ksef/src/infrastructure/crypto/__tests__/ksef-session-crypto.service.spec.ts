/**
 * KSeF session crypto service specs — CSPRNG key gen, RSA wrap, AES round-trip.
 *
 * @module libs/integrations/ksef/src/infrastructure/crypto
 */
import { createHash, generateKeyPairSync } from 'crypto';
import { KsefSessionCryptoService } from '../ksef-session-crypto.service';
import type { MfPublicKeyCacheService } from '../mf-public-key-cache.service';
import { unwrapKeyWithRsa } from '../rsa-key-wrapper';
import type { PublicKeyCertificate } from '../../http/ksef-crypto.types';
import { KSEF_AES_IV_BYTES, KSEF_AES_KEY_BYTES } from '../../http/ksef-crypto.constants';

describe('KsefSessionCryptoService', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

  const cert: PublicKeyCertificate = {
    certificatePem: publicPem,
    usage: ['SymmetricKeyEncryption'],
    validFrom: new Date('2026-01-01T00:00:00Z'),
    validTo: new Date('2027-01-01T00:00:00Z'),
    publicKeyId: 'PKID-SYM' + 'z'.repeat(36),
    certificateHash: createHash('sha256').update(publicPem).digest('hex'),
  };

  function service(): KsefSessionCryptoService {
    const cache = {
      fetchAndCachePublicKey: jest.fn().mockResolvedValue(cert),
    } as unknown as MfPublicKeyCacheService;
    return new KsefSessionCryptoService(cache);
  }

  it('should generate a 32-byte AES key + 16-byte IV and wrap the key under the MF cert', async () => {
    const ctx = await service().initializeSession();
    expect(ctx.symmetricKey.key.byteLength).toBe(KSEF_AES_KEY_BYTES);
    expect(ctx.symmetricKey.iv.byteLength).toBe(KSEF_AES_IV_BYTES);
    expect(ctx.wrappedKey.certificateHash).toBe(cert.certificateHash);
    // The wrapping cert's publicKeyId rides along so C5 can stamp
    // EncryptionInfo.publicKeyId on the session-open request.
    expect(ctx.wrappedKey.publicKeyId).toBe(cert.publicKeyId);

    // The server (holding the private half) must recover the exact AES key.
    const unwrapped = unwrapKeyWithRsa(ctx.wrappedKey.wrappedKey, privatePem);
    expect(Array.from(unwrapped)).toEqual(Array.from(ctx.symmetricKey.key));
  });

  it('should round-trip a document through encrypt/decrypt', async () => {
    const svc = service();
    const ctx = await svc.initializeSession();
    const plaintext = '<Faktura/>';
    const encrypted = svc.encryptDocument(plaintext, ctx);
    expect(svc.decryptDocument(encrypted, ctx)).toBe(plaintext);
  });

  it('should encrypt all documents with the session IV (KSeF declares one IV per session)', async () => {
    const svc = service();
    const ctx = await svc.initializeSession();
    const a = svc.encryptDocument('<Faktura>A</Faktura>', ctx);
    const b = svc.encryptDocument('<Faktura>A</Faktura>', ctx);

    // KSeF has no per-document IV field — all documents use the session IV.
    expect(Array.from(a.iv)).toEqual(Array.from(ctx.symmetricKey.iv));
    expect(Array.from(b.iv)).toEqual(Array.from(ctx.symmetricKey.iv));
    // Same plaintext + same IV → same ciphertext (deterministic under session IV).
    expect(Array.from(a.ciphertext)).toEqual(Array.from(b.ciphertext));
    // Round-trip still works.
    expect(svc.decryptDocument(a, ctx)).toBe('<Faktura>A</Faktura>');
    expect(svc.decryptDocument(b, ctx)).toBe('<Faktura>A</Faktura>');
  });

  it('should bound the session expiry by the cert validity', async () => {
    const now = new Date('2026-12-31T23:50:00Z');
    const ctx = await service().initializeSession(now);
    expect(ctx.expiresAt.getTime()).toBeLessThanOrEqual(cert.validTo.getTime());
  });
});
