/**
 * Unit tests for PrestashopShopCurrencyResolver (#1752)
 *
 * Verifies the shop-default-currency ISO is resolved from `PS_CURRENCY_DEFAULT`
 * → `/currencies/{id}`, cached per connection, and that any failure yields
 * `null` (never throws into product sync).
 */
import { PrestashopShopCurrencyResolver } from '../prestashop-shop-currency.resolver';
import type { IPrestashopWebserviceClient } from '../../http/prestashop-webservice.client.interface';

describe('PrestashopShopCurrencyResolver', () => {
  let resolver: PrestashopShopCurrencyResolver;
  let client: jest.Mocked<IPrestashopWebserviceClient>;

  beforeEach(() => {
    resolver = new PrestashopShopCurrencyResolver();
    client = {
      getResource: jest.fn((resource: string, id: string | number) => {
        if (resource === 'currencies' && String(id) === '2') {
          return Promise.resolve({ id: '2', iso_code: 'PLN' });
        }
        return Promise.resolve({});
      }),
      listResources: jest.fn((resource: string) => {
        if (resource === 'configurations') {
          return Promise.resolve([{ id: '1', name: 'PS_CURRENCY_DEFAULT', value: '2' }]);
        }
        return Promise.resolve([]);
      }),
      createResource: jest.fn(),
      updateResource: jest.fn(),
      deleteResource: jest.fn(),
      uploadImage: jest.fn(),
    } as unknown as jest.Mocked<IPrestashopWebserviceClient>;
  });

  it('should resolve the shop default currency ISO from PS_CURRENCY_DEFAULT', async () => {
    const iso = await resolver.resolveDefaultCurrencyIso('conn-1', client);

    expect(iso).toBe('PLN');
    expect(client.listResources).toHaveBeenCalledWith(
      'configurations',
      { custom: { name: 'PS_CURRENCY_DEFAULT' } },
      1,
      0
    );
    expect(client.getResource).toHaveBeenCalledWith('currencies', '2');
  });

  it('should uppercase the returned iso_code', async () => {
    client.getResource.mockResolvedValueOnce({ id: '2', iso_code: 'eur' });

    const iso = await resolver.resolveDefaultCurrencyIso('conn-1', client);

    expect(iso).toBe('EUR');
  });

  it('should cache per connection — a second call makes no WS request', async () => {
    await resolver.resolveDefaultCurrencyIso('conn-1', client);
    await resolver.resolveDefaultCurrencyIso('conn-1', client);

    expect(client.listResources).toHaveBeenCalledTimes(1);
    expect(client.getResource).toHaveBeenCalledTimes(1);
  });

  it('should fetch independently for different connections', async () => {
    await resolver.resolveDefaultCurrencyIso('conn-1', client);
    await resolver.resolveDefaultCurrencyIso('conn-2', client);

    expect(client.listResources).toHaveBeenCalledTimes(2);
  });

  it('should refetch after the cache is cleared', async () => {
    await resolver.resolveDefaultCurrencyIso('conn-1', client);
    resolver.clearCache('conn-1');
    await resolver.resolveDefaultCurrencyIso('conn-1', client);

    expect(client.listResources).toHaveBeenCalledTimes(2);
  });

  it('should return null when PS_CURRENCY_DEFAULT is absent', async () => {
    client.listResources.mockResolvedValueOnce([]);

    const iso = await resolver.resolveDefaultCurrencyIso('conn-1', client);

    expect(iso).toBeNull();
    expect(client.getResource).not.toHaveBeenCalled();
  });

  it('should return null when the currency has no iso_code', async () => {
    client.getResource.mockResolvedValueOnce({ id: '2' });

    const iso = await resolver.resolveDefaultCurrencyIso('conn-1', client);

    expect(iso).toBeNull();
  });

  it('should return null (never throw) when the WS request fails', async () => {
    client.listResources.mockRejectedValueOnce(new Error('boom'));

    await expect(resolver.resolveDefaultCurrencyIso('conn-1', client)).resolves.toBeNull();
  });
});
