/**
 * PrestaShop Connection Tester Adapter Unit Tests
 *
 * Exercises the error-translation path so failures produce structured,
 * UI-safe ConnectionTestResult values instead of throwing.
 *
 * @module libs/integrations/prestashop/src/infrastructure/adapters/__tests__
 */
import { PrestashopConnectionTesterAdapter } from '../prestashop-connection-tester.adapter';
import * as client from '../../http/prestashop-webservice.client';
import { Connection } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import type { HttpTransportFactoryPort } from '@openlinker/shared/http';
import { prestashopAdapterManifest } from '../../../prestashop-plugin';

describe('PrestashopConnectionTesterAdapter', () => {
  const http: jest.Mocked<HttpTransportFactoryPort> = {
    forConnection: jest.fn().mockReturnValue(jest.fn()),
    evict: jest.fn(),
  };
  const tester = new PrestashopConnectionTesterAdapter(
    http,
    prestashopAdapterManifest.defaultRateLimit
  );
  const resolver: CredentialsResolverPort = {
    get: jest.fn().mockResolvedValue({ webserviceApiKey: 'K' }),
  } as unknown as CredentialsResolverPort;
  const connection = new Connection(
    'c1',
    'prestashop',
    'X',
    'active',
    { baseUrl: 'https://shop.example' },
    'db:ref',
    new Date(),
    new Date(),
    undefined,
    ['ProductMaster'],
  );

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns success when the probe call resolves', async () => {
    jest
      .spyOn(client.PrestashopWebserviceClient.prototype, 'listResources')
      .mockResolvedValue([]);

    const result = await tester.test(connection, resolver);

    expect(result.success).toBe(true);
    expect(result.status).toBe(200);
    // ADR-077: an empty shop names no sales country, which the operator must hear
    // about here - the product master only says so in the worker log.
    expect(result.message).toBe(
      'OK. Warning: no sales country could be resolved, so catalogue prices will be ' +
        'unavailable. Set "salesCountryIso2" on the connection (for example PL).'
    );
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(http.forConnection).toHaveBeenCalledWith(connection, prestashopAdapterManifest.defaultRateLimit);
  });

  it('maps auth failures to success:false with status 401', async () => {
    const err = Object.assign(new Error('Bad key'), {
      name: 'PrestashopAuthenticationException',
    });
    jest
      .spyOn(client.PrestashopWebserviceClient.prototype, 'listResources')
      .mockRejectedValue(err);

    const result = await tester.test(connection, resolver);

    expect(result.success).toBe(false);
    expect(result.status).toBe(401);
    expect(result.message).toBe('Bad key');
  });

  it('propagates explicit statusCode from API exceptions', async () => {
    const err = Object.assign(new Error('Server error'), { statusCode: 503 });
    jest
      .spyOn(client.PrestashopWebserviceClient.prototype, 'listResources')
      .mockRejectedValue(err);

    const result = await tester.test(connection, resolver);

    expect(result.success).toBe(false);
    expect(result.status).toBe(503);
  });

  it('fails gracefully when baseUrl is missing', async () => {
    const broken = new Connection(
      'c2',
      'prestashop',
      'X',
      'active',
      {},
      'db:ref',
      new Date(),
      new Date(),
      undefined,
      [],
    );

    const result = await tester.test(broken, resolver);

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/baseUrl/);
  });

  // ADR-077: the test result names the country catalogue prices are read for,
  // because a wrong one makes taxed products report no price at all.
  describe('sales-country note (ADR-077)', () => {
    interface ShopFixture {
      configurations?: Array<{ id: string; name: string; value: string }>;
      /** Rows the `countries?filter[iso_code]` lookup answers with. */
      countriesByIso?: Array<{ id: string; iso_code: string; active: string }>;
      /** Rows `countries/{id}` answers with. */
      countryById?: Record<string, { id: string; iso_code: string }>;
      taxRules?: Array<{ id: string }>;
    }

    const connectionWith = (config: { salesCountryIso2?: string }): Connection =>
      new Connection(
        'c3',
        'prestashop',
        'X',
        'active',
        { baseUrl: 'https://shop.example', ...config },
        'db:ref',
        new Date(),
        new Date(),
        undefined,
        ['ProductMaster'],
      );

    type ListResourcesSpy = jest.SpyInstance<
      ReturnType<client.PrestashopWebserviceClient['listResources']>,
      Parameters<client.PrestashopWebserviceClient['listResources']>
    >;

    /** Serve the probe and the sales-country reads, keyed on the resource. */
    const wireShop = (shop: ShopFixture): ListResourcesSpy => {
      jest
        .spyOn(client.PrestashopWebserviceClient.prototype, 'getResource')
        .mockImplementation((resource, id) => {
          const row = shop.countryById?.[String(id)];
          if (resource === 'countries' && row !== undefined) {
            return Promise.resolve(row);
          }
          return Promise.reject(new Error(`unexpected read ${resource}/${String(id)}`));
        });
      return jest
        .spyOn(client.PrestashopWebserviceClient.prototype, 'listResources')
        .mockImplementation((resource) => {
          switch (resource) {
            case 'products':
              return Promise.resolve([]);
            case 'configurations':
              return Promise.resolve(shop.configurations ?? []);
            case 'countries':
              return Promise.resolve(shop.countriesByIso ?? []);
            case 'tax_rules':
              return Promise.resolve(shop.taxRules ?? []);
            default:
              return Promise.reject(new Error(`unexpected list ${resource}`));
          }
        });
    };

    it('should name the country from the connection setting when salesCountryIso2 is set', async () => {
      const list = wireShop({
        configurations: [{ id: '1', name: 'PS_COUNTRY_DEFAULT', value: '21' }],
        countriesByIso: [{ id: '14', iso_code: 'PL', active: '1' }],
        taxRules: [{ id: '3' }],
      });

      const result = await tester.test(connectionWith({ salesCountryIso2: 'PL' }), resolver);

      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
      expect(result.message).toBe('OK. Prices are read for PL (connection setting).');
      expect(list).toHaveBeenCalledWith('tax_rules', { custom: { id_country: 14 } }, 1);
    });

    it('should name the shop default country when no sales country is set', async () => {
      wireShop({
        configurations: [
          { id: '1', name: 'PS_COUNTRY_DEFAULT', value: '14' },
          { id: '2', name: 'PS_TAX', value: '1' },
        ],
        countryById: { '14': { id: '14', iso_code: 'PL' } },
        taxRules: [{ id: '3' }],
      });

      const result = await tester.test(connectionWith({}), resolver);

      expect(result.message).toBe('OK. Prices are read for PL (shop default country).');
    });

    it('should say taxes are switched off and skip the rule check when PS_TAX is 0', async () => {
      const list = wireShop({
        configurations: [
          { id: '1', name: 'PS_COUNTRY_DEFAULT', value: '14' },
          { id: '2', name: 'PS_TAX', value: '0' },
        ],
        countryById: { '14': { id: '14', iso_code: 'PL' } },
      });

      const result = await tester.test(connectionWith({}), resolver);

      expect(result.message).toBe(
        'OK. Prices are read for PL (shop default country); taxes are switched off in the shop.'
      );
      expect(list.mock.calls.some((call) => call[0] === 'tax_rules')).toBe(false);
    });

    // The stock docker install: the shop defaults to the United States, where no
    // tax rule exists, so every taxed product reports no price.
    it('should warn when no tax rule in the shop names the sales country', async () => {
      wireShop({
        configurations: [{ id: '1', name: 'PS_COUNTRY_DEFAULT', value: '21' }],
        countryById: { '21': { id: '21', iso_code: 'US' } },
        taxRules: [],
      });

      const result = await tester.test(connectionWith({}), resolver);

      expect(result.success).toBe(true);
      expect(result.message).toBe(
        'OK. Warning: prices are read for US (shop default country), but no tax rule in the ' +
          'shop names US, so taxed products will report no price. Set "salesCountryIso2" to ' +
          'the country you sell in.'
      );
    });

    it('should warn that no country resolved when the configured country does not exist in the shop', async () => {
      wireShop({
        configurations: [{ id: '1', name: 'PS_COUNTRY_DEFAULT', value: '14' }],
        countriesByIso: [],
        countryById: { '14': { id: '14', iso_code: 'PL' } },
      });

      const result = await tester.test(connectionWith({ salesCountryIso2: 'XX' }), resolver);

      expect(result.success).toBe(true);
      expect(result.message).toBe(
        'OK. Warning: no sales country could be resolved, so catalogue prices will be ' +
          'unavailable. Set "salesCountryIso2" on the connection (for example PL).'
      );
    });

    // The connection itself already proved to work; the note is best-effort.
    it('should still report success when the sales-country check itself fails', async () => {
      jest
        .spyOn(client.PrestashopWebserviceClient.prototype, 'listResources')
        .mockImplementation((resource) =>
          resource === 'products'
            ? Promise.resolve([])
            : Promise.reject(Object.assign(new Error('Server error'), { statusCode: 503 }))
        );

      const result = await tester.test(connectionWith({}), resolver);

      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
      expect(result.message).toBe('OK. The sales country could not be checked.');
    });
  });
});
