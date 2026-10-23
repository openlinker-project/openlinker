/**
 * WooCommerceTaxClassResolver — unit tests (#3505, G01-6)
 *
 * Drives the resolver through a mocked HTTP client routed by path, so the
 * assertions cover both the reads it issues and the class it resolves - and,
 * since ADR-077, the store's price basis and the per-class rate the catalogue
 * price conversion reads.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters/order-processor/__tests__
 */
import type { IWooCommerceHttpClient } from '../../../http/woocommerce-http-client.interface';
import type {
  WooCommerceGeneralSetting,
  WooCommerceTaxRate,
} from '../../product-master/woocommerce-product.types';
import { WooCommerceTaxClassResolver } from '../woocommerce-tax-class.resolver';

interface StoreSetup {
  calcTaxes?: 'yes' | 'no';
  classes?: string[];
  rates?: Record<string, WooCommerceTaxRate[]>;
  /** `woocommerce_default_country`; defaults to `'PL'`. */
  defaultCountry?: string;
  /** `woocommerce_price_num_decimals`; omitted from the settings when absent. */
  priceDecimals?: string;
  /** `woocommerce_prices_include_tax` on `/settings/tax`; defaults to `'no'`. */
  pricesIncludeTax?: 'yes' | 'no';
}

const GENERAL_SETTINGS_PATH = '/wp-json/wc/v3/settings/general';
const TAX_SETTINGS_PATH = '/wp-json/wc/v3/settings/tax';

function generalSettings(setup: StoreSetup): WooCommerceGeneralSetting[] {
  const rows: WooCommerceGeneralSetting[] = [
    { id: 'woocommerce_default_country', value: setup.defaultCountry ?? 'PL' },
    { id: 'woocommerce_calc_taxes', value: setup.calcTaxes ?? 'yes' },
  ];
  if (setup.priceDecimals !== undefined) {
    rows.push({ id: 'woocommerce_price_num_decimals', value: setup.priceDecimals });
  }
  return rows;
}

function makeHttpClient(setup: StoreSetup): jest.Mocked<IWooCommerceHttpClient> {
  const get = jest.fn((path: string, params?: Record<string, string | number | boolean>) => {
    if (path === GENERAL_SETTINGS_PATH) {
      return Promise.resolve(generalSettings(setup));
    }
    if (path === TAX_SETTINGS_PATH) {
      return Promise.resolve([
        { id: 'woocommerce_prices_include_tax', value: setup.pricesIncludeTax ?? 'no' },
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

  describe('rateFor (ADR-077)', () => {
    it('should give the standard class rate for the country when the line class is empty', async () => {
      const table = await new WooCommerceTaxClassResolver(makeHttpClient(POLISH_STORE)).load();

      expect(table?.rateFor('', 'PL')).toBe(23);
    });

    it('should give a named class its own rate for the country', async () => {
      const table = await new WooCommerceTaxClassResolver(makeHttpClient(POLISH_STORE)).load();

      expect(table?.rateFor('reduced-rate', 'PL')).toBe(5);
    });

    it('should give 0 when the class has no row for the country', async () => {
      const table = await new WooCommerceTaxClassResolver(makeHttpClient(POLISH_STORE)).load();

      expect(table?.rateFor('zero-rate', 'PL')).toBe(0);
    });

    it('should match the country regardless of case and surrounding spaces', async () => {
      const table = await new WooCommerceTaxClassResolver(makeHttpClient(POLISH_STORE)).load();

      expect(table?.rateFor('', ' pl ')).toBe(23);
    });

    it('should fall back to the wildcard row when the country has no row of its own', async () => {
      const table = await new WooCommerceTaxClassResolver(
        makeHttpClient({ rates: { standard: [rate('', '20.0000'), rate('PL', '23.0000')] } }),
      ).load();

      expect(table?.rateFor('', 'PL')).toBe(23);
      expect(table?.rateFor('', 'DE')).toBe(20);
      expect(table?.rateFor('', undefined)).toBe(20);
    });

    it('should stack the rates of different priorities when both apply', async () => {
      const table = await new WooCommerceTaxClassResolver(
        makeHttpClient({
          rates: { standard: [rate('PL', '20.0000'), rate('PL', '3.0000', { priority: 2 })] },
        }),
      ).load();

      expect(table?.rateFor('', 'PL')).toBe(23);
    });

    it('should give null when the store does not know the class', async () => {
      const table = await new WooCommerceTaxClassResolver(makeHttpClient(POLISH_STORE)).load();

      expect(table?.rateFor('luxury', 'PL')).toBeNull();
    });

    it('should give null when the class rows for the country are narrowed by postcode', async () => {
      const table = await new WooCommerceTaxClassResolver(
        makeHttpClient({
          rates: { standard: [rate('PL', '23.0000'), rate('PL', '8.0000', { postcode: '00-001' })] },
        }),
      ).load();

      expect(table?.rateFor('', 'PL')).toBeNull();
    });

    it('should give null when the class holds compound rows', async () => {
      const table = await new WooCommerceTaxClassResolver(
        makeHttpClient({
          rates: {
            standard: [rate('PL', '20.0000'), rate('PL', '3.0000', { priority: 2, compound: true })],
          },
        }),
      ).load();

      expect(table?.rateFor('', 'PL')).toBeNull();
    });
  });

  describe('readPriceBasis (ADR-077)', () => {
    function callsTo(httpClient: jest.Mocked<IWooCommerceHttpClient>, path: string): number {
      return httpClient.get.mock.calls.filter(([calledPath]) => calledPath === path).length;
    }

    it('should report taxes off without reading the tax settings when the store does not calculate taxes', async () => {
      const httpClient = makeHttpClient({ calcTaxes: 'no', pricesIncludeTax: 'yes' });

      const basis = await new WooCommerceTaxClassResolver(httpClient).readPriceBasis();

      expect(basis).toEqual({
        taxesEnabled: false,
        pricesIncludeTax: false,
        priceDecimals: 2,
        storeCountry: 'PL',
      });
      expect(callsTo(httpClient, TAX_SETTINGS_PATH)).toBe(0);
    });

    it('should report prices entered with tax when the store calculates taxes and says so', async () => {
      const httpClient = makeHttpClient({ calcTaxes: 'yes', pricesIncludeTax: 'yes' });

      const basis = await new WooCommerceTaxClassResolver(httpClient).readPriceBasis();

      expect(basis).toEqual({
        taxesEnabled: true,
        pricesIncludeTax: true,
        priceDecimals: 2,
        storeCountry: 'PL',
      });
      expect(callsTo(httpClient, TAX_SETTINGS_PATH)).toBe(1);
    });

    it('should report prices entered without tax when the store calculates taxes and says so', async () => {
      const basis = await new WooCommerceTaxClassResolver(
        makeHttpClient({ calcTaxes: 'yes', pricesIncludeTax: 'no' }),
      ).readPriceBasis();

      expect(basis.taxesEnabled).toBe(true);
      expect(basis.pricesIncludeTax).toBe(false);
    });

    it.each<[string, number]>([
      ['0', 0],
      ['3', 3],
    ])('should read the store price decimals when the setting is %s', async (setting, expected) => {
      const basis = await new WooCommerceTaxClassResolver(
        makeHttpClient({ priceDecimals: setting }),
      ).readPriceBasis();

      expect(basis.priceDecimals).toBe(expected);
    });

    it.each<[string, string | undefined]>([
      ['absent', undefined],
      ['empty', ''],
      ['not a number', 'abc'],
      ['negative', '-1'],
    ])('should fall back to 2 price decimals when the setting is %s', async (_label, setting) => {
      const basis = await new WooCommerceTaxClassResolver(
        makeHttpClient({ priceDecimals: setting }),
      ).readPriceBasis();

      expect(basis.priceDecimals).toBe(2);
    });

    it.each<[string, string | null]>([
      ['PL', 'PL'],
      ['PL:MZ', 'PL'],
      ['PL:*', 'PL'],
      ['de', 'DE'],
      ['', null],
    ])('should read the base country when the store default country is "%s"', async (setting, expected) => {
      const basis = await new WooCommerceTaxClassResolver(
        makeHttpClient({ defaultCountry: setting }),
      ).readPriceBasis();

      expect(basis.storeCountry).toBe(expected);
    });

    it('should read the store once per instance when asked repeatedly', async () => {
      const httpClient = makeHttpClient({ pricesIncludeTax: 'yes' });
      const resolver = new WooCommerceTaxClassResolver(httpClient);

      await resolver.readPriceBasis();
      await resolver.readPriceBasis();

      expect(callsTo(httpClient, GENERAL_SETTINGS_PATH)).toBe(1);
      expect(callsTo(httpClient, TAX_SETTINGS_PATH)).toBe(1);
    });

    it('should retry the read on the next call when the general settings read failed', async () => {
      const httpClient = makeHttpClient({ pricesIncludeTax: 'yes' });
      httpClient.get.mockRejectedValueOnce(new Error('network down'));
      const resolver = new WooCommerceTaxClassResolver(httpClient);

      await expect(resolver.readPriceBasis()).rejects.toThrow('network down');
      const basis = await resolver.readPriceBasis();

      expect(basis.pricesIncludeTax).toBe(true);
      expect(callsTo(httpClient, GENERAL_SETTINGS_PATH)).toBe(2);
    });

    it('should retry only the tax settings read on the next call when that read failed', async () => {
      const setup: StoreSetup = { pricesIncludeTax: 'yes' };
      const httpClient = makeHttpClient(setup);
      // The general settings are read first, then the tax settings.
      httpClient.get
        .mockResolvedValueOnce(generalSettings(setup))
        .mockRejectedValueOnce(new Error('tax settings down'));
      const resolver = new WooCommerceTaxClassResolver(httpClient);

      await expect(resolver.readPriceBasis()).rejects.toThrow('tax settings down');
      const basis = await resolver.readPriceBasis();

      expect(basis.pricesIncludeTax).toBe(true);
      expect(callsTo(httpClient, GENERAL_SETTINGS_PATH)).toBe(1);
      expect(callsTo(httpClient, TAX_SETTINGS_PATH)).toBe(2);
    });

    it('should share one general settings read with load', async () => {
      const httpClient = makeHttpClient(POLISH_STORE);
      const resolver = new WooCommerceTaxClassResolver(httpClient);

      await resolver.readPriceBasis();
      await resolver.load();

      expect(callsTo(httpClient, GENERAL_SETTINGS_PATH)).toBe(1);
    });

    it('should use the general settings reader it is handed instead of fetching them itself', async () => {
      const httpClient = makeHttpClient(POLISH_STORE);
      const readGeneral = jest.fn(() => Promise.resolve(generalSettings(POLISH_STORE)));
      const resolver = new WooCommerceTaxClassResolver(httpClient, readGeneral);

      const basis = await resolver.readPriceBasis();
      const table = await resolver.load();

      expect(basis.taxesEnabled).toBe(true);
      expect(table?.rateFor('', 'PL')).toBe(23);
      expect(readGeneral).toHaveBeenCalledTimes(1);
      expect(callsTo(httpClient, GENERAL_SETTINGS_PATH)).toBe(0);
    });

    it('should call the handed-in reader again when its read failed', async () => {
      const httpClient = makeHttpClient(POLISH_STORE);
      const readGeneral = jest
        .fn<Promise<WooCommerceGeneralSetting[]>, []>()
        .mockRejectedValueOnce(new Error('network down'))
        .mockResolvedValue(generalSettings(POLISH_STORE));
      const resolver = new WooCommerceTaxClassResolver(httpClient, readGeneral);

      await expect(resolver.readPriceBasis()).rejects.toThrow('network down');
      const basis = await resolver.readPriceBasis();

      expect(basis.taxesEnabled).toBe(true);
      expect(readGeneral).toHaveBeenCalledTimes(2);
    });
  });
});
