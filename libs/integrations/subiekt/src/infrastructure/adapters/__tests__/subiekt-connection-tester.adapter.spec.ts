/**
 * Subiekt Connection Tester — unit tests (#753)
 *
 * Mocks global.fetch (never real HTTP).
 *
 * @module libs/integrations/subiekt/src/infrastructure/adapters/__tests__
 */
import { Connection } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import { SubiektConnectionTesterAdapter } from '../subiekt-connection-tester.adapter';

function makeConnection(
  overrides: Partial<{ config: Record<string, unknown>; credentialsRef: string }> = {},
): Connection {
  return new Connection(
    'conn-1',
    'subiekt' as never,
    'Test',
    'active' as never,
    (overrides.config ?? { bridgeBaseUrl: 'http://192.168.1.10:5000' }) as never,
    overrides.credentialsRef ?? '',
    new Date(),
    new Date(),
    'subiekt.invoicing.v1',
    ['Invoicing'],
  );
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    headers: { get: (): string | null => null },
    json: (): Promise<unknown> => Promise.resolve(body),
  } as unknown as Response;
}

describe('SubiektConnectionTesterAdapter', () => {
  const tester = new SubiektConnectionTesterAdapter();
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('returns success:true with a token when the /health probe succeeds', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));
    const get = jest.fn().mockResolvedValue({ bridgeToken: 'secret-token' });
    const resolver = { get } as unknown as CredentialsResolverPort;

    const result = await tester.test(makeConnection({ credentialsRef: 'cred-1' }), resolver);

    expect(result.success).toBe(true);
    expect(get).toHaveBeenCalledWith('cred-1');
    // Token attached to the request header, never echoed in the result.
    const firstCall = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(firstCall[1].headers.authorization).toBe('Bearer secret-token');
  });

  it("credentialsRef '' -> success:true WITHOUT calling credentialsResolver.get", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));
    const get = jest.fn();
    const resolver = { get } as unknown as CredentialsResolverPort;

    const result = await tester.test(makeConnection({ credentialsRef: '' }), resolver);

    expect(result.success).toBe(true);
    expect(get).not.toHaveBeenCalled();
  });

  it('unreachable bridge -> success:false without throwing', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('connect'), { cause: { code: 'ECONNREFUSED' } }));
    const resolver = { get: jest.fn() } as unknown as CredentialsResolverPort;

    const result = await tester.test(makeConnection(), resolver);

    expect(result.success).toBe(false);
  });

  it('bad/IMDS bridgeBaseUrl -> success:false without throwing (construction error caught)', async () => {
    const resolver = { get: jest.fn() } as unknown as CredentialsResolverPort;

    const result = await tester.test(
      makeConnection({ config: { bridgeBaseUrl: 'http://169.254.169.254' } }),
      resolver,
    );

    expect(result.success).toBe(false);
  });

  it('never echoes the bridge token in the result message', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('connect'), { cause: { code: 'ECONNRESET' } }));
    const get = jest.fn().mockResolvedValue({ bridgeToken: 'super-secret-token' });
    const resolver = { get } as unknown as CredentialsResolverPort;

    const result = await tester.test(makeConnection({ credentialsRef: 'cred-1' }), resolver);

    expect(result.success).toBe(false);
    expect(result.message).not.toContain('super-secret-token');
  });
});
