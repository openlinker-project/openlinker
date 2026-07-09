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
import type { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import {
  isCategoryBrowser,
  isCategoryParametersReader,
  isOfferCreator,
  isOfferFieldUpdater,
} from '@openlinker/core/listings';
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
    json: (): Promise<Record<string, never>> => Promise.resolve({}),
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

  it('should resolve the sandbox base URL when config.environment is sandbox (#1377)', async () => {
    const client = await factory.createHttpClient(
      connection({ config: { environment: 'sandbox' } }),
      resolverFor({ apiKey: 'k-123' }),
    );
    await client.get('/probe');

    expect(lastFetchUrl()).toBe('https://sandbox.erli.dev/svc/shop-api/probe');
  });

  it('should resolve the default prod base URL when config.environment is production (#1377)', async () => {
    const client = await factory.createHttpClient(
      connection({ config: { environment: 'production' } }),
      resolverFor({ apiKey: 'k-123' }),
    );
    await client.get('/probe');

    expect(lastFetchUrl()).toBe('https://erli.pl/svc/shop-api/probe');
  });

  it('should let an explicit legacy config.baseUrl win over config.environment (backward compat, #1377)', async () => {
    // Connections created before the environment select persisted the derived
    // sandbox URL directly on config.baseUrl (with no config.environment). That
    // explicit override must still resolve the same host.
    const client = await factory.createHttpClient(
      connection({
        config: { baseUrl: 'https://sandbox.erli.dev/svc/shop-api', environment: 'production' },
      }),
      resolverFor({ apiKey: 'k-123' }),
    );
    await client.get('/probe');

    expect(lastFetchUrl()).toBe('https://sandbox.erli.dev/svc/shop-api/probe');
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
    // Defense-in-depth: the config-shape validator gates the https + host
    // allowlist at create/update, but a pre-existing/externally-written row could
    // carry plain http — the factory must refuse it rather than send the bearer
    // key over cleartext.
    await expect(
      factory.createHttpClient(
        connection({ config: { baseUrl: 'http://sandbox.erli.dev/svc/shop-api' } }),
        resolverFor({ apiKey: 'k-123' }),
      ),
    ).rejects.toBeInstanceOf(ErliConfigException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('should throw ErliConfigException when a config.baseUrl override targets a non-Erli host (SSRF)', async () => {
    // An https URL is not enough — the host must be Erli-owned, else a
    // misconfigured row would ship the bearer key to an attacker-controlled host.
    await expect(
      factory.createHttpClient(
        connection({ config: { baseUrl: 'https://evil.example.com/svc/shop-api' } }),
        resolverFor({ apiKey: 'k-123' }),
      ),
    ).rejects.toBeInstanceOf(ErliConfigException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe('createAdapters', () => {
    it('should return an offerManager supporting OfferCreator + OfferFieldUpdater', async () => {
      const adapters = await factory.createAdapters(
        connection(),
        {} as IdentifierMappingPort,
        resolverFor({ apiKey: 'k-123' }),
      );

      expect(isOfferCreator(adapters.offerManager)).toBe(true);
      expect(isOfferFieldUpdater(adapters.offerManager)).toBe(true);
    });

    it('should return an orderSource adapter (#993)', async () => {
      const adapters = await factory.createAdapters(
        connection(),
        {} as IdentifierMappingPort,
        resolverFor({ apiKey: 'k-123' }),
      );

      expect(typeof adapters.orderSource.listOrderFeed).toBe('function');
      expect(typeof adapters.orderSource.getOrder).toBe('function');
    });

    it('should propagate credential errors', async () => {
      await expect(
        factory.createAdapters(
          connection({ credentialsRef: undefined }),
          {} as IdentifierMappingPort,
          resolverFor({ apiKey: 'k' }),
        ),
      ).rejects.toBeInstanceOf(ErliConfigException);
    });

    it('should resolve credentials exactly once per call (#1399 review — no double resolve)', async () => {
      const resolver = resolverFor({
        apiKey: 'k-123',
        allegroClientId: 'client-1',
        allegroClientSecret: 'secret-1',
      });

      await factory.createAdapters(connection(), {} as IdentifierMappingPort, resolver);

      expect(resolver.get).toHaveBeenCalledTimes(1);
    });

    describe('Allegro category-catalog wiring (#1382/#1383, ADR-031)', () => {
      it('should NOT wire CategoryBrowser/CategoryParametersReader when Allegro credentials are absent', async () => {
        const adapters = await factory.createAdapters(
          connection(),
          {} as IdentifierMappingPort,
          resolverFor({ apiKey: 'k-123' }),
        );

        expect(isCategoryBrowser(adapters.offerManager)).toBe(false);
        expect(isCategoryParametersReader(adapters.offerManager)).toBe(false);
      });

      it('should NOT wire CategoryBrowser/CategoryParametersReader when only one of the Allegro credential pair is present', async () => {
        const adapters = await factory.createAdapters(
          connection(),
          {} as IdentifierMappingPort,
          resolverFor({ apiKey: 'k-123', allegroClientId: 'client-1' }),
        );

        expect(isCategoryBrowser(adapters.offerManager)).toBe(false);
        expect(isCategoryParametersReader(adapters.offerManager)).toBe(false);
      });

      it('should wire CategoryBrowser/CategoryParametersReader when both Allegro credentials are present', async () => {
        const adapters = await factory.createAdapters(
          connection(),
          {} as IdentifierMappingPort,
          resolverFor({
            apiKey: 'k-123',
            allegroClientId: 'client-1',
            allegroClientSecret: 'secret-1',
          }),
        );

        expect(isCategoryBrowser(adapters.offerManager)).toBe(true);
        expect(isCategoryParametersReader(adapters.offerManager)).toBe(true);
      });

      it('should resolve the Allegro sandbox host when config.allegroEnvironment is sandbox', async () => {
        const adapters = await factory.createAdapters(
          connection({ config: { allegroEnvironment: 'sandbox' } }),
          {} as IdentifierMappingPort,
          resolverFor({
            apiKey: 'k-123',
            allegroClientId: 'client-1',
            allegroClientSecret: 'secret-1',
          }),
        );
        expect(isCategoryBrowser(adapters.offerManager)).toBe(true);

        if (isCategoryBrowser(adapters.offerManager)) {
          await adapters.offerManager.fetchCategories();
        }

        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining('allegrosandbox.pl'),
          expect.anything(),
        );
      });
    });
  });
});
