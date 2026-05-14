/**
 * Crypto Service Unit Tests
 *
 * @module libs/shared/src/crypto
 */
import type { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { CryptoService } from './crypto.service';

function makeService(env: Record<string, string | undefined>): CryptoService {
  const config = {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
  const service = new CryptoService(config);
  service.onModuleInit();
  return service;
}

describe('CryptoService', () => {
  const validKey = randomBytes(32).toString('base64');

  it('round-trips plaintext through encrypt/decrypt', () => {
    const service = makeService({ OPENLINKER_CREDENTIALS_ENCRYPTION_KEY: validKey });
    const envelope = service.encrypt('super-secret');
    expect(service.decrypt(envelope)).toBe('super-secret');
  });

  it('produces different ciphertext for the same plaintext (random nonce)', () => {
    const service = makeService({ OPENLINKER_CREDENTIALS_ENCRYPTION_KEY: validKey });
    expect(service.encrypt('same')).not.toEqual(service.encrypt('same'));
  });

  it('rejects a tampered auth tag', () => {
    const service = makeService({ OPENLINKER_CREDENTIALS_ENCRYPTION_KEY: validKey });
    const envelope = service.encrypt('x');
    const buf = Buffer.from(envelope, 'base64');
    buf[buf.length - 1] ^= 0x01;
    expect(() => service.decrypt(buf.toString('base64'))).toThrow();
  });

  it('throws when key is missing in production', () => {
    expect(() => makeService({ NODE_ENV: 'production' })).toThrow(/required/);
  });

  it('throws when key is missing in staging (only development and test allow fallback)', () => {
    expect(() => makeService({ NODE_ENV: 'staging' })).toThrow(/required/);
  });

  it('falls back to dev key outside production with a warning', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation();
    const service = makeService({ NODE_ENV: 'development' });
    expect(service.decrypt(service.encrypt('ok'))).toBe('ok');
    warn.mockRestore();
  });

  it('rejects keys that do not decode to 32 bytes', () => {
    expect(() =>
      makeService({
        OPENLINKER_CREDENTIALS_ENCRYPTION_KEY: Buffer.from('short').toString('base64'),
      })
    ).toThrow(/32 bytes/);
  });
});
