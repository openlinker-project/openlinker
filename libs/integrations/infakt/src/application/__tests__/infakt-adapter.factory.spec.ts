/**
 * Infakt Adapter Factory — unit tests
 *
 * Verifies per-connection credential resolution and the sandbox-vs-production
 * `baseUrl` resolution. Stubs `global.fetch` to assert the constructed
 * `InfaktInvoicingAdapter`'s HTTP client hits the resolved base URL with the
 * resolved API key.
 *
 * @module libs/integrations/infakt/src/application/__tests__
 */
import type { LoggerPort } from '@openlinker/shared/logging';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { BuyerProfile } from '@openlinker/core/invoicing';
import { INFAKT_DEFAULT_BASE_URL } from '../../infrastructure/http/infakt-http-client';
import { InfaktAdapterFactory } from '../infakt-adapter.factory';

function connection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-1',
    platformType: 'infakt',
    name: 'Infakt',
    status: 'active',
    config: {},
    credentialsRef: 'ref-1',
    enabledCapabilities: [],
    adapterKey: 'infakt.accounting.v1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Connection;
}

function resolverFor(credentials: unknown): CredentialsResolverPort {
  return { get: jest.fn().mockResolvedValue(credentials) };
}

function fakeLogger(): jest.Mocked<LoggerPort> {
  return { log: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

function okResponse(): Response {
  return {
    ok: true,
    status: 200,
    text: (): Promise<string> => Promise.resolve('{}'),
  } as unknown as Response;
}

const originalFetch = global.fetch;

describe('InfaktAdapterFactory', () => {
  let factory: InfaktAdapterFactory;
  let fetchMock: jest.Mock;
  let logger: jest.Mocked<LoggerPort>;

  beforeEach(() => {
    factory = new InfaktAdapterFactory();
    fetchMock = jest.fn().mockResolvedValue(okResponse());
    global.fetch = fetchMock as unknown as typeof fetch;
    logger = fakeLogger();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  type FetchCall = [url: string, init: { headers: Record<string, string> }];
  function lastFetchCall(): FetchCall {
    const calls = fetchMock.mock.calls as FetchCall[];
    return calls[calls.length - 1];
  }

  it('should resolve the apiKey from the credentials resolver via connection.credentialsRef', async () => {
    const resolver = resolverFor({ apiKey: 'resolved-key' });
    await factory.createInvoicingAdapter(connection(), resolver, logger);

    expect(resolver.get).toHaveBeenCalledWith('ref-1');
  });

  it('should default to INFAKT_DEFAULT_BASE_URL when connection.config has no baseUrl', async () => {
    const resolver = resolverFor({ apiKey: 'k' });
    const adapter = await factory.createInvoicingAdapter(connection(), resolver, logger);

    await adapter.getInvoice({ providerInvoiceId: 'inv-1' }).catch(() => undefined);

    const [url, init] = lastFetchCall();
    expect(url).toContain(INFAKT_DEFAULT_BASE_URL);
    expect(init.headers['X-inFakt-ApiKey']).toBe('k');
  });

  it('should use the sandbox baseUrl override from connection.config when present', async () => {
    const resolver = resolverFor({ apiKey: 'k' });
    const sandboxUrl = 'https://api.sandbox.infakt.pl/api/v3';
    const adapter = await factory.createInvoicingAdapter(
      connection({ config: { baseUrl: sandboxUrl } }),
      resolver,
      logger,
    );

    await adapter.getInvoice({ providerInvoiceId: 'inv-1' }).catch(() => undefined);

    const [url] = lastFetchCall();
    expect(url).toContain(sandboxUrl);
  });

  it('should throw when the connection has no credentialsRef', async () => {
    const resolver = resolverFor({ apiKey: 'k' });
    await expect(
      factory.createInvoicingAdapter(connection({ credentialsRef: '' }), resolver, logger),
    ).rejects.toThrow(/no credentialsRef/);
  });

  it('should thread connection.config.defaultPaymentMethod into the constructed adapter (#1303)', async () => {
    // fetchMock resolves every call with a generic `{}` (see okResponse) —
    // sufficient here since we only assert the outbound request body for
    // the invoices.json POST, not the parsed response.
    const resolver = resolverFor({ apiKey: 'k' });
    const adapter = await factory.createInvoicingAdapter(
      connection({ config: { defaultPaymentMethod: 'transfer' } }),
      resolver,
      logger,
    );
    await adapter
      .issueInvoice({
        connectionId: 'conn-1',
        orderId: 'order-1',
        buyer: new BuyerProfile(
          'Acme',
          null,
          { line1: 'Testowa 1', line2: null, city: 'Warszawa', postalCode: '00-001', countryIso2: 'PL' },
          'private',
        ),
        currency: 'PLN',
        lines: [],
      })
      .catch(() => undefined);

    type PostCall = [url: string, init: { body: string }];
    const invoiceCall = (fetchMock.mock.calls as PostCall[]).find(([url]) => url.includes('invoices.json'));
    const body = JSON.parse(invoiceCall![1].body) as { invoice: { payment_method: string } };
    expect(body.invoice.payment_method).toBe('transfer');
  });
});
