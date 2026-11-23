/**
 * Mirakl Adapter Factory: unit tests
 *
 * The factory resolves the key, picks the profile's base URL by environment,
 * and threads the shop id; a bad row fails before any request.
 *
 * @module libs/integrations/mirakl/src/application
 */
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import { MiraklConfigException } from '../../domain/exceptions/mirakl-config.exception';
import { empikOperatorProfile } from '../../operators/empik.profile';
import { MiraklAdapterFactory } from '../mirakl-adapter.factory';

function connection(config: Record<string, unknown>, credentialsRef = 'ref-1'): Connection {
  return {
    id: 'conn-1',
    platformType: 'empik',
    name: 'Empik',
    status: 'active',
    config,
    credentialsRef,
    enabledCapabilities: [],
    adapterKey: 'empik.mirakl.v1',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function resolver(credentials: unknown): CredentialsResolverPort {
  return { get: jest.fn().mockResolvedValue(credentials) } as unknown as CredentialsResolverPort;
}

function okFetch(): jest.Mock {
  return jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    body: null,
    headers: { get: () => null },
    text: () => Promise.resolve('{}'),
  });
}

describe('MiraklAdapterFactory', () => {
  const factory = new MiraklAdapterFactory(empikOperatorProfile);

  it('should call the staging host with the key and shop id when configured for staging', async () => {
    const fetchMock = okFetch();
    const { httpClient } = await factory.createClients(
      connection({ environment: 'staging', shopId: 6881 }),
      resolver({ apiKey: ' key-1 ' }),
      fetchMock as unknown as typeof fetch,
    );

    await httpClient.get('/api/account');

    const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe('https://stg1.marketplace.empik.com/api/account?shop_id=6881');
    expect(init.headers.Authorization).toBe('key-1');
  });

  it('should call the production host when no environment is configured', async () => {
    const fetchMock = okFetch();
    const { httpClient } = await factory.createClients(
      connection({}),
      resolver({ apiKey: 'key-1' }),
      fetchMock as unknown as typeof fetch,
    );

    await httpClient.get('/api/account');

    expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe('https://marketplace.empik.com/api/account');
  });

  it('should build an import tracker on the same client', async () => {
    const { importTracker } = await factory.createClients(
      connection({}),
      resolver({ apiKey: 'key-1' }),
      okFetch() as unknown as typeof fetch,
    );

    expect(importTracker).toBeDefined();
  });

  it('should refuse a connection without a credentials reference', async () => {
    await expect(
      factory.createClients(connection({}, ''), resolver({ apiKey: 'k' }), okFetch() as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(MiraklConfigException);
  });

  it('should refuse credentials without an API key', async () => {
    await expect(
      factory.createClients(connection({}), resolver({ apiKey: '  ' }), okFetch() as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(MiraklConfigException);
  });

  it('should refuse an invalid shop id instead of falling back to the default shop', async () => {
    await expect(
      factory.createClients(
        connection({ shopId: '6881&shop_id=1' }),
        resolver({ apiKey: 'k' }),
        okFetch() as unknown as typeof fetch,
      ),
    ).rejects.toBeInstanceOf(MiraklConfigException);
  });

  describe('createAdapters', () => {
    function ordersFetch(): jest.Mock {
      return jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: null,
        headers: { get: () => null },
        text: () => Promise.resolve('{"orders":[],"total_count":0}'),
      });
    }

    function requestedUrls(fetchMock: jest.Mock): string[] {
      return fetchMock.mock.calls.map((call) => (call as unknown[])[0] as string);
    }

    it('should build an order source that accepts waiting orders by default', async () => {
      const fetchMock = ordersFetch();
      const { orderSource } = await factory.createAdapters(
        connection({}),
        resolver({ apiKey: 'k' }),
        fetchMock as unknown as typeof fetch,
      );

      await orderSource.listOrderFeed({ fromCursor: null, limit: 100 });

      expect(requestedUrls(fetchMock)[0]).toContain('order_state_codes=WAITING_ACCEPTANCE');
    });

    it('should build an order source that leaves waiting orders alone when acceptance is off', async () => {
      const fetchMock = ordersFetch();
      const { orderSource } = await factory.createAdapters(
        connection({ orderAcceptance: 'off' }),
        resolver({ apiKey: 'k' }),
        fetchMock as unknown as typeof fetch,
      );

      await orderSource.listOrderFeed({ fromCursor: null, limit: 100 });

      expect(requestedUrls(fetchMock).some((url) => url.includes('=WAITING_ACCEPTANCE&'))).toBe(false);
      expect(requestedUrls(fetchMock)).toHaveLength(1);
    });
  });
});
