import type { ShoperHttpClient } from '../../http/shoper-http-client';
import { ShoperOrderOptionsProvider } from '../shoper-order-options.provider';

function setup(get: jest.Mock): ShoperOrderOptionsProvider {
  return new ShoperOrderOptionsProvider({ get } as unknown as ShoperHttpClient);
}

describe('ShoperOrderOptionsProvider', () => {
  it('should read a shipping tax once per method', async () => {
    const get = jest.fn().mockResolvedValue({ status: 200, data: { shipping_id: '8', tax_id: '1' } });
    const provider = setup(get);

    await expect(provider.getShippingTaxId(8)).resolves.toBe('1');
    await provider.getShippingTaxId(8);

    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('/shippings/8');
  });

  it('should retry a failed shipping read instead of replaying the rejection', async () => {
    const get = jest
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({ status: 200, data: { shipping_id: '8', tax_id: '2' } });
    const provider = setup(get);

    await expect(provider.getShippingTaxId(8)).rejects.toThrow('boom');
    await expect(provider.getShippingTaxId(8)).resolves.toBe('2');
  });

  it('should resolve a currency code case-insensitively and read the table once', async () => {
    const get = jest.fn().mockResolvedValue({
      status: 200,
      data: { count: '2', pages: 1, page: 1, list: [{ currency_id: '1', name: 'PLN' }, { currency_id: '2', name: 'USD' }] },
    });
    const provider = setup(get);

    await expect(provider.getCurrencyId('pln')).resolves.toBe('1');
    await expect(provider.getCurrencyId('EUR')).resolves.toBeNull();

    expect(get).toHaveBeenCalledTimes(1);
  });
});
