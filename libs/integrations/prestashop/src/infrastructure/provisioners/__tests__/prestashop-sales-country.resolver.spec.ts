/**
 * Unit tests for the PrestaShop sales-country resolver (ADR-077).
 *
 * The country a connection's gross catalogue prices are stated for: the
 * connection's `salesCountryIso2` when set, else the shop's
 * `PS_COUNTRY_DEFAULT`. A configuration gap answers `null` (cached briefly), a
 * failed call to PrestaShop throws.
 *
 * @module libs/integrations/prestashop/src/infrastructure/provisioners
 */
import { Logger } from '@openlinker/shared/logging';
import { PrestashopSalesCountryResolver } from '../prestashop-sales-country.resolver';
import type { PrestashopCountryResolver } from '../prestashop-country-resolver';
import { PrestashopApiException } from '../../../domain/exceptions/prestashop-api.exception';
import { PrestashopCountryNotFoundException } from '../../../domain/exceptions/prestashop-country-not-found.exception';
import { createMockHttpClient } from '../../../__tests__/mocks/mock-http-client.factory';

interface ConfigRow {
  id: string;
  name: string;
  value: string;
}

interface CountryRow {
  id: string;
  iso_code?: string;
}

const PS_DEFAULT_PL: ConfigRow = { id: '1', name: 'PS_COUNTRY_DEFAULT', value: '14' };
const PS_TAX_ON: ConfigRow = { id: '2', name: 'PS_TAX', value: '1' };
const PS_TAX_OFF: ConfigRow = { id: '2', name: 'PS_TAX', value: '0' };

describe('PrestashopSalesCountryResolver', () => {
  let httpClient: ReturnType<typeof createMockHttpClient>;
  let countryResolver: jest.Mocked<PrestashopCountryResolver>;
  let resolver: PrestashopSalesCountryResolver;
  let warn: jest.SpyInstance;

  /** Serve the configuration rows and the countries the shop holds. */
  const wireShop = (configs: ConfigRow[], countries: Record<string, CountryRow> = {}): void => {
    httpClient.listResources.mockImplementation((resource) =>
      resource === 'configurations'
        ? Promise.resolve(configs)
        : Promise.reject(new Error(`unexpected list ${resource}`))
    );
    httpClient.getResource.mockImplementation((resource, id) => {
      if (resource !== 'countries') {
        return Promise.reject(new Error(`unexpected read ${resource}/${String(id)}`));
      }
      const row = countries[String(id)];
      return row !== undefined
        ? Promise.resolve(row)
        : Promise.reject(new PrestashopApiException('Resource not found', 404));
    });
  };

  beforeEach(() => {
    httpClient = createMockHttpClient();
    countryResolver = {
      resolveCountryId: jest.fn(),
      clearCache: jest.fn(),
    } as unknown as jest.Mocked<PrestashopCountryResolver>;
    resolver = new PrestashopSalesCountryResolver(countryResolver);
    // A configuration gap is non-blocking, so the warn is the operator's only
    // trace of it - assert it, don't just silence it.
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
    jest.useRealTimers();
  });

  describe('the connection setting', () => {
    it('should resolve the configured country with source "setting" when salesCountryIso2 is set', async () => {
      wireShop([{ id: '1', name: 'PS_COUNTRY_DEFAULT', value: '21' }, PS_TAX_ON]);
      countryResolver.resolveCountryId.mockResolvedValueOnce(14);

      const country = await resolver.resolve('conn-1', 'pl', httpClient);

      expect(country).toEqual({ countryId: 14, iso2: 'PL', source: 'setting', taxesEnabled: true });
      expect(countryResolver.resolveCountryId).toHaveBeenCalledWith('PL', 'conn-1', httpClient);
      // The setting wins outright: the shop default is never read.
      expect(httpClient.getResource).not.toHaveBeenCalled();
    });

    it('should read PS_COUNTRY_DEFAULT and PS_TAX in one configurations request when resolving', async () => {
      wireShop([PS_TAX_ON]);
      countryResolver.resolveCountryId.mockResolvedValueOnce(14);

      await resolver.resolve('conn-1', 'PL', httpClient);

      expect(httpClient.listResources).toHaveBeenCalledTimes(1);
      expect(httpClient.listResources).toHaveBeenCalledWith(
        'configurations',
        { custom: { name: ['PS_COUNTRY_DEFAULT', 'PS_TAX'] } },
        10,
        0
      );
    });

    it('should answer null rather than fall back to the shop default when the configured country is unknown or inactive', async () => {
      wireShop([PS_DEFAULT_PL, PS_TAX_ON], { '14': { id: '14', iso_code: 'PL' } });
      countryResolver.resolveCountryId.mockRejectedValueOnce(
        new PrestashopCountryNotFoundException('XX (country exists but is not active)', 'conn-1')
      );

      const country = await resolver.resolve('conn-1', 'XX', httpClient);

      expect(country).toBeNull();
      expect(httpClient.getResource).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('prestashop_sales_country_unresolved'));
    });

    it('should rethrow when the configured country lookup fails for a reason other than not-found', async () => {
      wireShop([PS_TAX_ON]);
      const failure = new PrestashopApiException('gateway', 503);
      countryResolver.resolveCountryId.mockRejectedValueOnce(failure);

      await expect(resolver.resolve('conn-1', 'PL', httpClient)).rejects.toBe(failure);
    });

    it('should treat a blank setting as no setting when the value is only whitespace', async () => {
      wireShop([PS_DEFAULT_PL, PS_TAX_ON], { '14': { id: '14', iso_code: 'PL' } });

      const country = await resolver.resolve('conn-1', '   ', httpClient);

      expect(country).toEqual({
        countryId: 14,
        iso2: 'PL',
        source: 'shop-default',
        taxesEnabled: true,
      });
      expect(countryResolver.resolveCountryId).not.toHaveBeenCalled();
    });
  });

  describe('the shop default country', () => {
    it('should resolve PS_COUNTRY_DEFAULT to its ISO with source "shop-default" when no setting is given', async () => {
      wireShop([PS_DEFAULT_PL, PS_TAX_ON], { '14': { id: '14', iso_code: 'pl' } });

      const country = await resolver.resolve('conn-1', undefined, httpClient);

      expect(country).toEqual({
        countryId: 14,
        iso2: 'PL',
        source: 'shop-default',
        taxesEnabled: true,
      });
      expect(httpClient.getResource).toHaveBeenCalledWith('countries', 14);
      expect(countryResolver.resolveCountryId).not.toHaveBeenCalled();
    });

    it('should answer null when the shop has no PS_COUNTRY_DEFAULT', async () => {
      wireShop([PS_TAX_ON]);

      const country = await resolver.resolve('conn-1', undefined, httpClient);

      expect(country).toBeNull();
      expect(httpClient.getResource).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('prestashop_sales_country_unresolved'));
    });

    it.each(['0', '-3', 'abc', ''])(
      'should answer null without reading a country when PS_COUNTRY_DEFAULT is %p',
      async (value) => {
        wireShop([{ id: '1', name: 'PS_COUNTRY_DEFAULT', value }, PS_TAX_ON]);

        const country = await resolver.resolve('conn-1', undefined, httpClient);

        expect(country).toBeNull();
        expect(httpClient.getResource).not.toHaveBeenCalled();
      }
    );

    it('should answer null when the default country does not exist in the shop (404)', async () => {
      wireShop([PS_DEFAULT_PL, PS_TAX_ON], {});

      const country = await resolver.resolve('conn-1', undefined, httpClient);

      expect(country).toBeNull();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('PS_COUNTRY_DEFAULT=14'));
    });

    it('should answer null when the default country carries no iso_code', async () => {
      wireShop([PS_DEFAULT_PL, PS_TAX_ON], { '14': { id: '14' } });

      const country = await resolver.resolve('conn-1', undefined, httpClient);

      expect(country).toBeNull();
    });

    it('should rethrow when reading the default country fails for a reason other than 404', async () => {
      wireShop([PS_DEFAULT_PL, PS_TAX_ON]);
      const failure = new PrestashopApiException('gateway', 503);
      // A queued once-value takes precedence over the wired implementation.
      httpClient.getResource.mockRejectedValueOnce(failure);

      await expect(resolver.resolve('conn-1', undefined, httpClient)).rejects.toBe(failure);
    });

    it('should rethrow when the configurations read fails', async () => {
      const failure = new PrestashopApiException('gateway', 502);
      httpClient.listResources.mockRejectedValueOnce(failure);

      await expect(resolver.resolve('conn-1', undefined, httpClient)).rejects.toBe(failure);
    });
  });

  describe('PS_TAX', () => {
    it('should report taxes switched off when PS_TAX is 0', async () => {
      wireShop([PS_DEFAULT_PL, PS_TAX_OFF], { '14': { id: '14', iso_code: 'PL' } });

      const country = await resolver.resolve('conn-1', undefined, httpClient);

      expect(country?.taxesEnabled).toBe(false);
    });

    it('should report taxes enabled when PS_TAX is absent', async () => {
      wireShop([PS_DEFAULT_PL], { '14': { id: '14', iso_code: 'PL' } });

      const country = await resolver.resolve('conn-1', undefined, httpClient);

      expect(country?.taxesEnabled).toBe(true);
    });

    it('should carry PS_TAX through on the setting path too when it is 0', async () => {
      wireShop([PS_TAX_OFF]);
      countryResolver.resolveCountryId.mockResolvedValueOnce(14);

      const country = await resolver.resolve('conn-1', 'PL', httpClient);

      expect(country).toEqual({
        countryId: 14,
        iso2: 'PL',
        source: 'setting',
        taxesEnabled: false,
      });
    });
  });

  describe('caching', () => {
    const start = new Date('2026-10-12T10:00:00Z').getTime();

    it('should answer a resolved country from cache when asked again', async () => {
      wireShop([PS_DEFAULT_PL, PS_TAX_ON], { '14': { id: '14', iso_code: 'PL' } });

      const first = await resolver.resolve('conn-1', undefined, httpClient);
      const second = await resolver.resolve('conn-1', undefined, httpClient);

      expect(second).toEqual(first);
      expect(httpClient.listResources).toHaveBeenCalledTimes(1);
      expect(httpClient.getResource).toHaveBeenCalledTimes(1);
    });

    it('should keep a resolved country past the short TTL and re-read it when an hour has passed', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(start);
      wireShop([PS_DEFAULT_PL, PS_TAX_ON], { '14': { id: '14', iso_code: 'PL' } });

      await resolver.resolve('conn-1', undefined, httpClient);

      jest.setSystemTime(start + 61_000);
      await resolver.resolve('conn-1', undefined, httpClient);
      expect(httpClient.listResources).toHaveBeenCalledTimes(1);

      jest.setSystemTime(start + 60 * 60 * 1000);
      await resolver.resolve('conn-1', undefined, httpClient);
      expect(httpClient.listResources).toHaveBeenCalledTimes(2);
    });

    // An operator fixing the shop or the setting must see the fix within a
    // minute, not after the hour a resolved answer is kept for.
    it('should cache a null answer for under a minute and re-read it after 60 seconds', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(start);
      wireShop([PS_TAX_ON]);

      expect(await resolver.resolve('conn-1', undefined, httpClient)).toBeNull();

      // The operator sets PS_COUNTRY_DEFAULT in the shop.
      wireShop([PS_DEFAULT_PL, PS_TAX_ON], { '14': { id: '14', iso_code: 'PL' } });

      jest.setSystemTime(start + 59_999);
      expect(await resolver.resolve('conn-1', undefined, httpClient)).toBeNull();
      expect(httpClient.listResources).toHaveBeenCalledTimes(1);

      jest.setSystemTime(start + 60_000);
      expect(await resolver.resolve('conn-1', undefined, httpClient)).toEqual({
        countryId: 14,
        iso2: 'PL',
        source: 'shop-default',
        taxesEnabled: true,
      });
      expect(httpClient.listResources).toHaveBeenCalledTimes(2);
    });

    it('should not cache a failed read, so the next call retries', async () => {
      httpClient.listResources.mockRejectedValueOnce(new PrestashopApiException('gateway', 503));
      await expect(resolver.resolve('conn-1', undefined, httpClient)).rejects.toThrow('gateway');

      wireShop([PS_DEFAULT_PL, PS_TAX_ON], { '14': { id: '14', iso_code: 'PL' } });
      const country = await resolver.resolve('conn-1', undefined, httpClient);

      expect(country?.iso2).toBe('PL');
    });

    it('should key the cache by the configured ISO, normalised, when the setting changes', async () => {
      wireShop([PS_DEFAULT_PL, PS_TAX_ON], { '14': { id: '14', iso_code: 'PL' } });
      countryResolver.resolveCountryId.mockImplementation((iso) =>
        Promise.resolve(iso === 'PL' ? 14 : 1)
      );

      const pl = await resolver.resolve('conn-1', 'PL', httpClient);
      const de = await resolver.resolve('conn-1', 'DE', httpClient);
      const plAgain = await resolver.resolve('conn-1', ' pl ', httpClient);
      const shopDefault = await resolver.resolve('conn-1', undefined, httpClient);

      expect(pl?.countryId).toBe(14);
      expect(de).toEqual({ countryId: 1, iso2: 'DE', source: 'setting', taxesEnabled: true });
      expect(plAgain).toEqual(pl);
      expect(shopDefault?.source).toBe('shop-default');
      // PL, DE and the unset setting: three keys, three reads. ' pl ' hit PL's entry.
      expect(httpClient.listResources).toHaveBeenCalledTimes(3);
    });

    it('should read once per connection when two connections ask', async () => {
      wireShop([PS_DEFAULT_PL, PS_TAX_ON], { '14': { id: '14', iso_code: 'PL' } });

      await resolver.resolve('conn-1', undefined, httpClient);
      await resolver.resolve('conn-2', undefined, httpClient);

      expect(httpClient.listResources).toHaveBeenCalledTimes(2);
    });
  });

  describe('clearCache', () => {
    beforeEach(() => {
      wireShop([PS_DEFAULT_PL, PS_TAX_ON], { '14': { id: '14', iso_code: 'PL' } });
    });

    it('should drop one connection and keep the other cached when given a connection id', async () => {
      await resolver.resolve('conn-1', undefined, httpClient);
      await resolver.resolve('conn-2', undefined, httpClient);

      resolver.clearCache('conn-1');
      await resolver.resolve('conn-1', undefined, httpClient);
      await resolver.resolve('conn-2', undefined, httpClient);

      expect(httpClient.listResources).toHaveBeenCalledTimes(3);
    });

    it('should drop every configured-ISO entry of a connection when its cache is cleared', async () => {
      countryResolver.resolveCountryId.mockResolvedValue(14);
      await resolver.resolve('conn-1', 'PL', httpClient);
      await resolver.resolve('conn-1', undefined, httpClient);

      resolver.clearCache('conn-1');
      await resolver.resolve('conn-1', 'PL', httpClient);
      await resolver.resolve('conn-1', undefined, httpClient);

      expect(httpClient.listResources).toHaveBeenCalledTimes(4);
    });

    it('should drop every connection when called without one', async () => {
      await resolver.resolve('conn-1', undefined, httpClient);
      await resolver.resolve('conn-2', undefined, httpClient);

      resolver.clearCache();
      await resolver.resolve('conn-1', undefined, httpClient);
      await resolver.resolve('conn-2', undefined, httpClient);

      expect(httpClient.listResources).toHaveBeenCalledTimes(4);
    });
  });
});
