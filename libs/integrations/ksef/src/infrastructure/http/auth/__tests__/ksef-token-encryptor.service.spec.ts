/**
 * KSeF token encryptor specs — RSA-OAEP wrap of the token|timestamp payload +
 * `InitTokenAuthenticationRequest` assembly (spec shape: challenge,
 * contextIdentifier {type,value}, encryptedToken, publicKeyId?).
 *
 * @module libs/integrations/ksef/src/infrastructure/http/auth
 */
import { createHash, generateKeyPairSync } from 'crypto';
import { KsefTokenEncryptor } from '../ksef-token-encryptor.service';
import type { MfPublicKeyCacheService } from '../../../crypto/mf-public-key-cache.service';
import { unwrapKeyWithRsa } from '../../../crypto/rsa-key-wrapper';
import type { PublicKeyCertificate } from '../../ksef-crypto.types';

describe('KsefTokenEncryptor', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

  const cert: PublicKeyCertificate = {
    certificatePem: publicPem,
    usage: ['KsefTokenEncryption'],
    validFrom: new Date('2026-01-01T00:00:00Z'),
    validTo: new Date('2027-01-01T00:00:00Z'),
    publicKeyId: 'PKID-' + 'x'.repeat(39),
    certificateHash: createHash('sha256').update(publicPem).digest('hex'),
  };

  it('should produce an init request whose ciphertext unwraps to token|timestamp', async () => {
    const fetchSpy = jest.fn().mockResolvedValue(cert);
    const cache = { fetchAndCachePublicKey: fetchSpy } as unknown as MfPublicKeyCacheService;
    const encryptor = new KsefTokenEncryptor(cache);

    const result = await encryptor.buildInitRequest(
      'TKN-123',
      '1234567890',
      'CH-NONCE',
      '2026-06-23T12:00:00Z',
    );

    expect(fetchSpy).toHaveBeenCalledWith('KsefTokenEncryption');
    expect(result.challenge).toBe('CH-NONCE');
    expect(result.contextIdentifier).toEqual({ type: 'Nip', value: '1234567890' });
    expect(result.publicKeyId).toBe(cert.publicKeyId);
    const wrapped = new Uint8Array(Buffer.from(result.encryptedToken, 'base64'));
    const recovered = Buffer.from(unwrapKeyWithRsa(wrapped, privatePem)).toString('utf8');
    expect(recovered).toBe('TKN-123|2026-06-23T12:00:00Z');
  });

  it('should omit publicKeyId when the cert carries none', async () => {
    const certNoId: PublicKeyCertificate = { ...cert, publicKeyId: undefined };
    const cache = {
      fetchAndCachePublicKey: jest.fn().mockResolvedValue(certNoId),
    } as unknown as MfPublicKeyCacheService;
    const result = await new KsefTokenEncryptor(cache).buildInitRequest('T', '111', 'CH', 'ts');
    expect(result.publicKeyId).toBeUndefined();
  });

  it('should never echo the plaintext token in the result', async () => {
    const cache = {
      fetchAndCachePublicKey: jest.fn().mockResolvedValue(cert),
    } as unknown as MfPublicKeyCacheService;
    const result = await new KsefTokenEncryptor(cache).buildInitRequest('SECRET', '111', 'CH', 'ts');
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });
});
