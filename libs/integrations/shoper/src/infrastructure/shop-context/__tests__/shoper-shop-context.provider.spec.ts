import type { ShoperHttpClient } from '../../http/shoper-http-client';
import { ShoperShopContextProvider } from '../shoper-shop-context.provider';

const CONFIG = {
  default_language_name: 'pl_PL',
  default_currency_name: 'PLN',
  locale_default_weight: 'KILOGRAM',
};

function providerWith(get: jest.Mock): ShoperShopContextProvider {
  return new ShoperShopContextProvider({ get } as unknown as ShoperHttpClient, 'shop.example.pl');
}

describe('ShoperShopContextProvider', () => {
  it('should read language, currency and weight unit from application-config', async () => {
    const get = jest.fn().mockResolvedValue({ status: 200, data: CONFIG });

    await expect(providerWith(get).get()).resolves.toEqual({
      host: 'shop.example.pl',
      language: 'pl_PL',
      currency: 'PLN',
      weightUnit: 'KILOGRAM',
    });
    expect(get).toHaveBeenCalledWith('/application-config');
  });

  it('should share ONE request between concurrent callers and later ones', async () => {
    const get = jest.fn().mockResolvedValue({ status: 200, data: CONFIG });
    const provider = providerWith(get);

    await Promise.all([provider.get(), provider.get(), provider.get()]);
    await provider.get();

    expect(get).toHaveBeenCalledTimes(1);
  });

  it('should not cache a failure: the next call retries', async () => {
    const get = jest
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ status: 200, data: CONFIG });
    const provider = providerWith(get);

    await expect(provider.get()).rejects.toThrow('boom');
    await expect(provider.get()).resolves.toMatchObject({ language: 'pl_PL' });
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('should tolerate a shop that omits the optional fields', async () => {
    const get = jest.fn().mockResolvedValue({ status: 200, data: {} });

    await expect(providerWith(get).get()).resolves.toEqual({
      host: 'shop.example.pl',
      language: '',
      currency: null,
      weightUnit: 'KILOGRAM',
    });
  });
});
