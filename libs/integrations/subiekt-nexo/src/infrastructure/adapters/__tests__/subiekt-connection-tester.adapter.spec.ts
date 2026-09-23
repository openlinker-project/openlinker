/**
 * Subiekt Connection Tester — unit tests (#753)
 *
 * Mocks the connection-bound transport (`HttpTransportFactoryPort.forConnection`),
 * never `global.fetch` directly (#1810) — `global.fetch` is stubbed to a poison
 * value that throws if invoked, so a regression that stops threading the
 * transport into the client (falling back to its `?? globalThis.fetch` default)
 * fails loudly instead of the test silently passing against the wrong fetch.
 *
 * @module libs/integrations/subiekt-nexo/src/infrastructure/adapters/__tests__
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
    'subiekt-nexo' as never,
    'Test',
    'active' as never,
    (overrides.config ?? { bridgeBaseUrl: 'http://192.168.1.10:5000' }) as never,
    overrides.credentialsRef ?? '',
    new Date(),
    new Date(),
    'subiekt.nexo.v1',
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

  it('returns success:true with a token when the authorized probe succeeds', async () => {
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

  it('probes an AUTHORIZED route, never /health', async () => {
    // The bridge exempts /health from its auth middleware, so probing it proves
    // reachability and NOTHING about the credential. Asserted on the URL rather
    // than on a client method name so that swapping the probe back to /health
    // fails here even if the method keeps its name.
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));
    const resolver = { get: jest.fn() } as unknown as CredentialsResolverPort;

    await tester.test(makeConnection(), resolver);

    const url = (fetchMock.mock.calls[0] as [string, unknown])[0];
    expect(url).toContain('/api/bank-accounts');
    expect(url).not.toContain('/health');
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

  // --- the defect this probe exists to close ---------------------------------

  it('401 -> success:false, NOT a green tick', async () => {
    // The whole point. Before the probe moved off /health, this case answered
    // success:true and the connection then failed on its first real call.
    fetchMock.mockResolvedValue(
      jsonResponse(401, {
        success: false,
        data: null,
        error: { code: 'unauthorized', reason: 'bad or missing bridge token' },
      }),
    );
    const resolver = { get: jest.fn() } as unknown as CredentialsResolverPort;

    const result = await tester.test(makeConnection(), resolver);

    expect(result.success).toBe(false);
  });

  it("401 surfaces the bridge's OWN reason, so the operator can tell WHICH auth problem they have", async () => {
    // "not configured" and "wrong value" need different remedies, and only the
    // bridge knows which one applies. Generic copy sent the operator hunting a
    // bad value when nothing had been set at all.
    fetchMock.mockResolvedValue(
      jsonResponse(401, {
        success: false,
        data: null,
        error: {
          code: 'unauthorized',
          reason:
            'bridge token is not configured - set InvoiceToken in appsettings.json or OL_BRIDGE_INVOICE_TOKEN',
        },
      }),
    );
    const resolver = { get: jest.fn() } as unknown as CredentialsResolverPort;

    const result = await tester.test(makeConnection(), resolver);

    expect(result.success).toBe(false);
    expect(result.message).toContain('InvoiceToken');
  });

  it('redacts the token from a 401 reason that echoes it back', async () => {
    // Reading the 401 body is only safe because of this. The body comes from a
    // service we do not control, so "our bridge does not echo the token" is not
    // a property this client may rely on.
    fetchMock.mockResolvedValue(
      jsonResponse(401, {
        success: false,
        data: null,
        error: { code: 'unauthorized', reason: 'token super-secret-token was rejected' },
      }),
    );
    const get = jest.fn().mockResolvedValue({ bridgeToken: 'super-secret-token' });
    const resolver = { get } as unknown as CredentialsResolverPort;

    const result = await tester.test(makeConnection({ credentialsRef: 'cred-1' }), resolver);

    expect(result.success).toBe(false);
    expect(result.message).not.toContain('super-secret-token');
    expect(result.message).toContain('[redacted]');
  });

  it.each([
    ['a different case', 'token SUPER-SECRET-TOKEN was rejected'],
    ['a percent-encoded copy', 'see /auth?t=super-secret%2Dtoken for details'],
    ['a WWW-Authenticate-style challenge', 'Bearer realm="bridge", token="super-secret-token"'],
  ])('redacts the token echoed back as %s', async (_label, reason) => {
    // The argument for reading the 401 body at all is that "our bridge does not
    // echo the token" is not a property this client may rely on - so it must not
    // assume the echo is byte-identical either.
    fetchMock.mockResolvedValue(
      jsonResponse(401, { success: false, data: null, error: { code: 'unauthorized', reason } }),
    );
    const get = jest.fn().mockResolvedValue({ bridgeToken: 'super-secret-token' });
    const resolver = { get } as unknown as CredentialsResolverPort;

    const result = await tester.test(makeConnection({ credentialsRef: 'cred-1' }), resolver);

    expect(result.success).toBe(false);
    expect(result.message.toLowerCase()).not.toContain('super-secret-token');
    expect(result.message).toContain('[redacted]');
  });

  it('does NOT redact a token too short to redact safely', async () => {
    // `split/join` on a two-character secret would shred the bridge's own
    // sentence - the redaction would become the thing that made the message
    // unreadable. A secret that short is not one worth protecting.
    fetchMock.mockResolvedValue(
      jsonResponse(401, {
        success: false,
        data: null,
        error: { code: 'unauthorized', reason: 'bridge token is not configured' },
      }),
    );
    const get = jest.fn().mockResolvedValue({ bridgeToken: 'ab' });
    const resolver = { get } as unknown as CredentialsResolverPort;

    const result = await tester.test(makeConnection({ credentialsRef: 'cred-1' }), resolver);

    expect(result.success).toBe(false);
    expect(result.message).toContain('bridge token is not configured');
    expect(result.message).not.toContain('[redacted]');
  });

  it('401 with an unreadable body does not pad the message with "HTTP 401"', async () => {
    fetchMock.mockResolvedValue({
      status: 401,
      headers: { get: (): string | null => null },
      json: (): Promise<unknown> => Promise.reject(new Error('not json')),
    } as unknown as Response);
    const resolver = { get: jest.fn() } as unknown as CredentialsResolverPort;

    const result = await tester.test(makeConnection(), resolver);

    expect(result.success).toBe(false);
    expect(result.message).not.toContain('HTTP 401');
  });
});
