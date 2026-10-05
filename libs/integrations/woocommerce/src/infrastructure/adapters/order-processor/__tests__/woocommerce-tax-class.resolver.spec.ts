/**
 * WooCommerceTaxClassResolver — unit tests (#3505, G01-6)
 *
 * Drives the resolver through a mocked HTTP client routed by path, so the
 * assertions cover both the reads it issues and the class it resolves.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters/order-processor/__tests__
 */
import type { IWooCommerceHttpClient } from '../../../http/woocommerce-http-client.interface';
import type { WooCommerceTaxRate } from '../../product-master/woocommerce-product.types';
import { WooCommerceTaxClassResolver } from '../woocommerce-tax-class.resolver';

interface StoreSetup {
  calcTaxes?: 'yes' | 'no';
  classes?: string[];
  rates?: Record<string, WooCommerceTaxRate[]>;
}

function makeHttpClient(setup: StoreSetup): jest.Mocked<IWooCommerceHttpClient> {
  const get = jest.fn((path: string, params?: Record<string, string | number | boolean>) => {
    if (path === '/wp-json/wc/v3/settings/general') {
      return Promise.resolve([
        { id: 'woocommerce_default_country', value: 'PL' },
        { id: 'woocommerce_calc_taxes', value: setup.calcTaxes ?? 'yes' },
      ]);
    }
    if (path === '/wp-json/wc/v3/taxes/classes') {
      return Promise.resolve(
        ['standard', ...(setup.classes ?? [])].map((slug) => ({ slug, name: slug })),
      );
    }
    if (path === '/wp-json/wc/v3/taxes') {
      const slug = String(params?.class);
      return Promise.resolve(params?.page === 1 ? (setup.rates?.[slug] ?? []) : []);
    }
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
  return {
    get: get as unknown as jest.Mocked<IWooCommerceHttpClient>['get'],
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  };
}

function rate(country: string, value: string, extra: Partial<WooCommerceTaxRate> = {}): WooCommerceTaxRate {
  return { country, rate: value, priority: 1, compound: false, state: '', postcode: '', city: '', ...extra };
}

const POLISH_STORE: StoreSetup = {
  classes: ['reduced-rate', 'zero-rate'],
  rates: {
    standard: [rate('PL', '23.0000')],
    'reduced-rate': [rate('PL', '5.0000')],
    'zero-rate': [],
  },
};

describe('WooCommerceTaxClassResolver', () => {
  it('should resolve to null when the store does not calculate taxes', async () => {
    const httpClient = makeHttpClient({ ...POLISH_STORE, calcTaxes: 'no' });

    const table = await new WooCommerceTaxClassResolver(httpClient).load();

    expect(table).toBeNull();
    expect(httpClient.get).toHaveBeenCalledTimes(1);
  });

  it('should resolve the standard rate to the empty class when taxes are on', async () => {
    const table = await new WooCommerceTaxClassResolver(makeHttpClient(POLISH_STORE)).load();

    expect(table?.resolve('PL', 23)).toBe('');
  });

  it('should resolve a reduced rate to its class slug', async () => {
    const table = await new WooCommerceTaxClassResolver(makeHttpClient(POLISH_STORE)).load();

    expect(table?.resolve('PL', 5)).toBe('reduced-rate');
  });

  it('should resolve a 0% line to a class with no rate for the country', async () => {
    const table = await new WooCommerceTaxClassResolver(makeHttpClient(POLISH_STORE)).load();

    expect(table?.resolve('PL', 0)).toBe('zero-rate');
  });

  it('should resolve to null when no class gives the rate', async () => {
    const table = await new WooCommerceTaxClassResolver(makeHttpClient(POLISH_STORE)).load();

    expect(table?.resolve('PL', 8)).toBeNull();
  });

  it('should match a wildcard row for any country without its own row', async () => {
    const table = await new WooCommerceTaxClassResolver(
      makeHttpClient({ rates: { standard: [rate('', '20.0000')] } }),
    ).load();

    expect(table?.resolve('DE', 20)).toBe('');
    expect(table?.resolve(undefined, 20)).toBe('');
  });

  it('should prefer the country row over the wildcard row at the same priority', async () => {
    const table = await new WooCommerceTaxClassResolver(
      makeHttpClient({ rates: { standard: [rate('', '20.0000'), rate('PL', '23.0000')] } }),
    ).load();

    expect(table?.resolve('PL', 23)).toBe('');
    expect(table?.resolve('PL', 20)).toBeNull();
  });

  it('should stack rates of different priorities', async () => {
    const table = await new WooCommerceTaxClassResolver(
      makeHttpClient({
        rates: { standard: [rate('PL', '20.0000'), rate('PL', '3.0000', { priority: 2 })] },
      }),
    ).load();

    expect(table?.resolve('PL', 23)).toBe('');
  });

  it('should never match a class whose rows for the country are narrowed by postcode', async () => {
    const table = await new WooCommerceTaxClassResolver(
      makeHttpClient({
        rates: { standard: [rate('PL', '23.0000'), rate('PL', '8.0000', { postcode: '00-001' })] },
      }),
    ).load();

    expect(table?.resolve('PL', 23)).toBeNull();
  });

  it('should never match a class holding compound rows', async () => {
    const table = await new WooCommerceTaxClassResolver(
      makeHttpClient({
        rates: { standard: [rate('PL', '20.0000'), rate('PL', '3.0000', { priority: 2, compound: true })] },
      }),
    ).load();

    expect(table?.resolve('PL', 23)).toBeNull();
  });

  it('should prefer the standard class when two classes give the same rate', async () => {
    const table = await new WooCommerceTaxClassResolver(
      makeHttpClient({
        classes: ['duplicate'],
        rates: { standard: [rate('PL', '23.0000')], duplicate: [rate('PL', '23.0000')] },
      }),
    ).load();

    expect(table?.resolve('PL', 23)).toBe('');
  });

  it('should read the store once per instance when asked repeatedly', async () => {
    const httpClient = makeHttpClient(POLISH_STORE);
    const resolver = new WooCommerceTaxClassResolver(httpClient);

    await resolver.load();
    const callsAfterFirstLoad = httpClient.get.mock.calls.length;
    await resolver.load();

    expect(httpClient.get.mock.calls.length).toBe(callsAfterFirstLoad);
  });

  it('should retry the read on the next call when a read failed', async () => {
    const httpClient = makeHttpClient(POLISH_STORE);
    httpClient.get.mockRejectedValueOnce(new Error('network down'));
    const resolver = new WooCommerceTaxClassResolver(httpClient);

    await expect(resolver.load()).rejects.toThrow('network down');
    const table = await resolver.load();

    expect(table?.resolve('PL', 23)).toBe('');
  });
});
