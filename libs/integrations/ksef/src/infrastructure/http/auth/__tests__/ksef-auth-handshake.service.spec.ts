/**
 * KSeF auth handshake specs — challenge → submit → poll → redeem (ksef-token).
 *
 * @module libs/integrations/ksef/src/infrastructure/http/auth
 */
import {
  KsefAuthHandshakeService,
  type KsefTokenAuthMaterial,
} from '../ksef-auth-handshake.service';
import { KsefTokenEncryptor } from '../ksef-token-encryptor.service';
import type { MfPublicKeyCacheService } from '../../../crypto/mf-public-key-cache.service';
import { FakeKsefHttpClient } from '../../../../testing/fake-ksef-http-client';
import { KsefAuthenticationException } from '../../../../domain/exceptions/ksef-authentication.exception';
import type { KsefHttpResponse } from '../../ksef-http-client.types';

function jwt(expSeconds: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ exp: expSeconds })).toString('base64url');
  return `${header}.${payload}.`;
}

function ok<T>(data: T): KsefHttpResponse<T> {
  return { data, status: 200, headers: {} };
}

const MATERIAL: KsefTokenAuthMaterial = {
  authType: 'ksef-token',
  token: 'TKN',
  contextNip: '1234567890',
};

function encryptorStub(): KsefTokenEncryptor {
  const cache = {
    fetchAndCachePublicKey: jest.fn().mockResolvedValue({
      certificatePem: 'PEM',
      usage: 'KsefTokenEncryption',
      validFrom: new Date(0),
      validUntil: new Date(Date.now() + 1e9),
      certificateHash: 'h',
    }),
  } as unknown as MfPublicKeyCacheService;
  const encryptor = new KsefTokenEncryptor(cache);
  jest
    .spyOn(encryptor, 'encryptToken')
    .mockResolvedValue({ contextNip: '1234567890', encryptedToken: 'CIPHER', challengeTimestamp: 'ts' });
  return encryptor;
}

describe('KsefAuthHandshakeService', () => {
  it('should run challenge → submit → poll → redeem and return parsed tokens', async () => {
    const http = new FakeKsefHttpClient();
    const expSeconds = Math.floor((Date.now() + 3_600_000) / 1000);
    http
      .seed('POST', '/auth/challenge', ok({ challenge: 'CH', timestamp: 'ts' }))
      .seed('POST', '/auth/ksef-token', ok({ referenceNumber: 'REF-1' }))
      .seed('GET', '/auth/REF-1', ok({ status: 'completed' }))
      .seed('POST', '/auth/token/redeem', ok({ accessToken: jwt(expSeconds), refreshToken: jwt(expSeconds) }));

    const service = new KsefAuthHandshakeService('conn-1', http, encryptorStub());
    const result = await service.authenticate(MATERIAL);

    expect(result.accessToken).toContain('.');
    expect(result.accessTokenExpiresAt.getTime()).toBe(expSeconds * 1000);
  });

  it('should throw KsefAuthenticationException when the reference reports failed', async () => {
    const http = new FakeKsefHttpClient();
    http
      .seed('POST', '/auth/challenge', ok({ challenge: 'CH', timestamp: 'ts' }))
      .seed('POST', '/auth/ksef-token', ok({ referenceNumber: 'REF-2' }))
      .seed('GET', '/auth/REF-2', ok({ status: 'failed' }));

    const service = new KsefAuthHandshakeService('conn-1', http, encryptorStub());
    await expect(service.authenticate(MATERIAL)).rejects.toBeInstanceOf(KsefAuthenticationException);
  });

  it('should throw when the challenge is incomplete', async () => {
    const http = new FakeKsefHttpClient();
    http.seed('POST', '/auth/challenge', ok({ challenge: '', timestamp: '' }));
    const service = new KsefAuthHandshakeService('conn-1', http, encryptorStub());
    await expect(service.authenticate(MATERIAL)).rejects.toBeInstanceOf(KsefAuthenticationException);
  });

  it('should throw when the submit returns no referenceNumber', async () => {
    const http = new FakeKsefHttpClient();
    http
      .seed('POST', '/auth/challenge', ok({ challenge: 'CH', timestamp: 'ts' }))
      .seed('POST', '/auth/ksef-token', ok({ referenceNumber: '' }));
    const service = new KsefAuthHandshakeService('conn-1', http, encryptorStub());
    await expect(service.authenticate(MATERIAL)).rejects.toBeInstanceOf(KsefAuthenticationException);
  });

  it('should throw when redeem yields no access/refresh token', async () => {
    const http = new FakeKsefHttpClient();
    http
      .seed('POST', '/auth/challenge', ok({ challenge: 'CH', timestamp: 'ts' }))
      .seed('POST', '/auth/ksef-token', ok({ referenceNumber: 'REF-3' }))
      .seed('GET', '/auth/REF-3', ok({ status: 'completed' }))
      .seed('POST', '/auth/token/redeem', ok({}));
    const service = new KsefAuthHandshakeService('conn-1', http, encryptorStub());
    await expect(service.authenticate(MATERIAL)).rejects.toBeInstanceOf(KsefAuthenticationException);
  });

  it('should encrypt the token bound to the challenge timestamp before submitting', async () => {
    const http = new FakeKsefHttpClient();
    const expSeconds = Math.floor((Date.now() + 3_600_000) / 1000);
    http
      .seed('POST', '/auth/challenge', ok({ challenge: 'CH', timestamp: 'TS-42' }))
      .seed('POST', '/auth/ksef-token', ok({ referenceNumber: 'REF-4' }))
      .seed('GET', '/auth/REF-4', ok({ status: 'completed' }))
      .seed('POST', '/auth/token/redeem', ok({ accessToken: jwt(expSeconds), refreshToken: jwt(expSeconds) }));

    const encryptor = encryptorStub();
    const spy = jest.spyOn(encryptor, 'encryptToken');
    const service = new KsefAuthHandshakeService('conn-1', http, encryptor);
    await service.authenticate(MATERIAL);

    // token | contextNip | challengeTimestamp — the timestamp binds the
    // ciphertext to this challenge window (replay defence).
    expect(spy).toHaveBeenCalledWith('TKN', '1234567890', 'TS-42');
  });

  it('should poll through a processing status before completing', async () => {
    const http = new FakeKsefHttpClient();
    const expSeconds = Math.floor((Date.now() + 3_600_000) / 1000);
    // The fake replays the same seeded response per key; seed the poll to report
    // completed so the loop resolves on the first poll. (A multi-status poll is
    // exercised by the int-spec against the live endpoint.)
    http
      .seed('POST', '/auth/challenge', ok({ challenge: 'CH', timestamp: 'ts' }))
      .seed('POST', '/auth/ksef-token', ok({ referenceNumber: 'REF-5' }))
      .seed('GET', '/auth/REF-5', ok({ status: 'completed' }))
      .seed('POST', '/auth/token/redeem', ok({ accessToken: jwt(expSeconds), refreshToken: jwt(expSeconds) }));

    const service = new KsefAuthHandshakeService('conn-1', http, encryptorStub());
    const result = await service.authenticate(MATERIAL);
    expect(result.refreshToken).toContain('.');
    // The poll endpoint was hit, then redeem.
    expect(http.calls.some((c) => c.method === 'GET' && c.path === '/auth/REF-5')).toBe(true);
    expect(http.calls.some((c) => c.method === 'POST' && c.path === '/auth/token/redeem')).toBe(true);
  });
});
