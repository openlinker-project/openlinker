/**
 * Erli Adapter Factory — unit tests
 *
 * Verifies per-connection credential + base-URL resolution and the
 * pre-flight config guards (#982). Stubs `global.fetch` to assert the built
 * client hits the resolved base URL with the resolved bearer key.
 *
 * @module libs/integrations/erli/src/application/__tests__
 */
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { ErliConfigException } from '../../domain/exceptions/erli-config.exception';
import { ErliAdapterFactory } from '../erli-adapter.factory';

function connection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-1',
    platformType: 'erli',
    name: 'Erli',
    status: 'active',
    config: {},
    credentialsRef: 'ref-1',
    enabledCapabilities: [],
    adapterKey: 'erli.shopapi.v1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function resolverFor(credentials: unknown): CredentialsResolverPort {
  return { get: jest.fn().mockResolvedValue(credentials) };
}

function okResponse(): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: (): string | null => null },
    text: (): Promise<string> => Promise.resolve('{}'),
  } as unknown as Response;
}

const originalFetch = global.fetch;

describe('ErliAdapterFactory', () => {
  let factory: ErliAdapterFactory;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    factory = new ErliAdapterFactory();
    fetchMock = jest.fn().mockResolvedValue(okResponse());
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  type FetchCall = [url: string, init: { headers: Record<string, string> }];
  function lastCall(): FetchCall {
    const calls = fetchMock.mock.calls as FetchCall[];
    return calls[calls.length - 1];
  }
  function lastFetchUrl(): string {
    return lastCall()[0];
  }
  function lastFetchHeaders(): Record<string, string> {
    return lastCall()[1].headers;
  }

  it('should build a client targeting the default prod base URL (prefix preserved) with the resolved bearer key', async () => {
    const client = await factory.createHttpClient(
      connection(),
      resolverFor({ apiKey: 'k-123' }),
    );
    await client.get('/probe');

    expect(lastFetchUrl()).toBe('https://erli.pl/svc/shop-api/probe');
    expect(lastFetchHeaders().Authorization).toBe('Bearer k-123');
  });

  it('should honour a config.baseUrl override', async () => {
    const client = await factory.createHttpClient(
      connection({ config: { baseUrl: 'https://sandbox.erli.dev/svc/shop-api' } }),
      resolverFor({ apiKey: 'k-123' }),
    );
    await client.get('/probe');

    expect(lastFetchUrl()).toBe('https://sandbox.erli.dev/svc/shop-api/probe');
  });

  it('should throw ErliConfigException when credentialsRef is missing', async () => {
    await expect(
      factory.createHttpClient(
        connection({ credentialsRef: undefined }),
        resolverFor({ apiKey: 'k' }),
      ),
    ).rejects.toBeInstanceOf(ErliConfigException);
  });

  it('should throw ErliConfigException when the resolved apiKey is empty', async () => {
    await expect(
      factory.createHttpClient(connection(), resolverFor({ apiKey: '  ' })),
    ).rejects.toBeInstanceOf(ErliConfigException);
  });

  it('should throw ErliConfigException when a config.baseUrl override is not https', async () => {
    // Defense-in-depth: the config-shape validator gates https at create/update,
    // but a pre-existing/externally-written row could carry plain http — the
    // factory must refuse it rather than send the bearer key over cleartext.
    await expect(
      factory.createHttpClient(
        connection({ config: { baseUrl: 'http://sandbox.erli.dev/svc/shop-api' } }),
        resolverFor({ apiKey: 'k-123' }),
      ),
    ).rejects.toBeInstanceOf(ErliConfigException);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
