/**
 * Unit tests for PrestashopOrderCurrencyResolver (#2277)
 *
 * Covers the three-rung resolution chain (order `id_currency` -> shop default
 * -> refuse), the caching contract (resolved codes only, one read per
 * `(connection, id_currency)`), and the read-failure split that keeps a
 * transport error retryable while a configuration gap refuses.
 */
import { PrestashopOrderCurrencyResolver } from '../prestashop-order-currency.resolver';
import { PrestashopShopCurrencyResolver } from '../prestashop-shop-currency.resolver';
import { PrestashopApiException } from '../../../domain/exceptions/prestashop-api.exception';
import { PrestashopCurrencyUnknownException } from '../../../domain/exceptions/prestashop-currency-unknown.exception';
import { createMockHttpClient } from '../../../__tests__/mocks/mock-http-client.factory';
import type { IPrestashopWebserviceClient } from '../../http/prestashop-webservice.client.interface';

describe('PrestashopOrderCurrencyResolver', () => {
  let client: jest.Mocked<IPrestashopWebserviceClient>;
  let shopCurrencyResolver: PrestashopShopCurrencyResolver;
  let resolver: PrestashopOrderCurrencyResolver;

  const resolve = (idCurrency?: string | number, connectionId = 'conn-1'): Promise<string> =>
    resolver.resolveOrderCurrencyIso({
      connectionId,
      client,
      idCurrency,
      orderRef: 'ORDER-042',
    });

  beforeEach(() => {
    client = createMockHttpClient();
    client.getResource.mockImplementation((resource: string, id: string | number) => {
      if (resource === 'currencies' && String(id) === '2') {
        return Promise.resolve({ id: '2', iso_code: 'pln ' });
      }
      if (resource === 'currencies' && String(id) === '3') {
        return Promise.resolve({ id: '3' });
      }
      return Promise.reject(new PrestashopApiException('Not Found', 404));
    });
    client.listResources.mockImplementation((resource: string) => {
      if (resource === 'configurations') {
        return Promise.resolve([{ id: '1', name: 'PS_CURRENCY_DEFAULT', value: '2' }]);
      }
      return Promise.resolve([]);
    });

    shopCurrencyResolver = new PrestashopShopCurrencyResolver();
    resolver = new PrestashopOrderCurrencyResolver(shopCurrencyResolver);
  });

  describe("rung 1 - the order's own id_currency", () => {
    it('should resolve the ISO code of the order currency, normalised', async () => {
      await expect(resolve('2')).resolves.toBe('PLN');
      expect(client.getResource).toHaveBeenCalledWith('currencies', '2');
    });

    it('should accept a numeric id_currency, as the JSON output format returns it', async () => {
      await expect(resolve(2)).resolves.toBe('PLN');
    });

    it('should never consult the shop default when the order resolves on its own', async () => {
      await resolve('2');

      expect(client.listResources).not.toHaveBeenCalledWith(
        'configurations',
        expect.anything(),
        expect.anything(),
        expect.anything()
      );
    });
  });

  describe('rung 2 - the shop default', () => {
    it.each([
      ['absent', undefined],
      ['an unset foreign key (0)', '0'],
      ['blank', '   '],
    ])('should fall back to the shop default when id_currency is %s', async (_label, value) => {
      await expect(resolve(value)).resolves.toBe('PLN');
      expect(client.listResources).toHaveBeenCalledWith(
        'configurations',
        { custom: { name: 'PS_CURRENCY_DEFAULT' } },
        1,
        0
      );
    });
  });

  describe('rung 3 - refuse', () => {
    it('should refuse an id_currency the shop has no row for rather than substituting one', async () => {
      await expect(resolve('9')).rejects.toBeInstanceOf(PrestashopCurrencyUnknownException);
    });

    it('should refuse a currency row that carries no iso_code', async () => {
      await expect(resolve('3')).rejects.toBeInstanceOf(PrestashopCurrencyUnknownException);
    });

    it('should refuse when the order carries no currency and the shop reports no default', async () => {
      client.listResources.mockResolvedValue([]);

      await expect(resolve(undefined)).rejects.toBeInstanceOf(PrestashopCurrencyUnknownException);
    });

    it('should lead the message with the identity, which the orders list clips to ~40 chars', async () => {
      await expect(resolve('9')).rejects.toThrow(/^Currency id 9 unknown in PrestaShop/);
    });

    it('should name the order in the message so the operator can find it', async () => {
      await expect(resolve('9')).rejects.toThrow(/ORDER-042/);
    });

    it('should never cache a refusal, so fixing the shop is picked up on the next attempt', async () => {
      await expect(resolve('9')).rejects.toBeInstanceOf(PrestashopCurrencyUnknownException);

      client.getResource.mockResolvedValueOnce({ id: '9', iso_code: 'CZK' });
      await expect(resolve('9')).resolves.toBe('CZK');
    });
  });

  describe('read failures stay retryable', () => {
    it('should propagate a non-404 API error unchanged rather than refusing the order', async () => {
      const serverError = new PrestashopApiException('Bad Gateway', 502);
      client.getResource.mockRejectedValueOnce(serverError);

      await expect(resolve('2')).rejects.toBe(serverError);
    });
  });

  describe('caching', () => {
    it('should issue at most one GET /currencies/{id} per (connection, id_currency)', async () => {
      await resolve('2');
      await resolve('2');
      await resolve('2');

      expect(client.getResource).toHaveBeenCalledTimes(1);
    });

    it('should key the cache on the connection, not on the id alone', async () => {
      await resolve('2', 'conn-1');
      await resolve('2', 'conn-2');

      expect(client.getResource).toHaveBeenCalledTimes(2);
    });

    it('should re-read after clearCache for the affected connection only', async () => {
      await resolve('2', 'conn-1');
      await resolve('2', 'conn-2');
      resolver.clearCache('conn-1');

      await resolve('2', 'conn-1');
      await resolve('2', 'conn-2');

      expect(client.getResource).toHaveBeenCalledTimes(3);
    });
  });
});
