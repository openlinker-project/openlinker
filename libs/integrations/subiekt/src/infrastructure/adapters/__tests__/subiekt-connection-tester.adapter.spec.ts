/**
 * Subiekt Connection Tester — unit tests (#753)
 *
 * Mocks the connection-bound transport (`HttpTransportFactoryPort.forConnection`),
 * never `global.fetch` directly (#1810) — `global.fetch` is stubbed to a poison
 * value that throws if invoked, so a regression that stops threading the
 * transport into the client (falling back to its `?? globalThis.fetch` default)
 * fails loudly instead of the test silently passing against the wrong fetch.
 *
 * @module libs/integrations/subiekt/src/infrastructure/adapters/__tests__
 */
import { Connection } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import type { HttpTransportFactoryPort } from '@openlinker/shared/http';
import { SubiektConnectionTesterAdapter } from '../subiekt-connection-tester.adapter';
import { subiektAdapterManifest } from '../../../subiekt-plugin';

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
  let fetchMock: jest.Mock;
  let http: jest.Mocked<HttpTransportFactoryPort>;
  let tester: SubiektConnectionTesterAdapter;

  beforeEach(() => {
    fetchMock = jest.fn();
    http = {
      forConnection: jest.fn().mockReturnValue(fetchMock),
      evict: jest.fn(),
    };
    tester = new SubiektConnectionTesterAdapter(http, subiektAdapterManifest.defaultRateLimit);
    // Poison, not stubbed to `fetchMock` — every request must go through the
    // connection-bound transport `forConnection` returns, never this global
    // directly. If the client's `?? globalThis.fetch` fallback is ever
    // reached, this throws instead of the test silently passing against it.
    global.fetch = jest.fn(() => {
      throw new Error('bare globalThis.fetch invoked — outbound transport not wired (#1810)');
    }) as unknown as typeof fetch;
  });

  it('resolves the connection-bound transport via host.http.forConnection (#1810)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));
    const resolver = { get: jest.fn() } as unknown as CredentialsResolverPort;
    const connection = makeConnection();

    await tester.test(connection, resolver);

    expect(http.forConnection).toHaveBeenCalledWith(connection, subiektAdapterManifest.defaultRateLimit);
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
