import { envelope } from '../../__tests__/shoper-test-data';
import type { ShoperHttpClient } from '../../http/shoper-http-client';
import { ShoperTaxTableProvider } from '../shoper-tax-table.provider';

const ROWS = [
  { tax_id: '1', value: '23', name: '23%' },
  { tax_id: '4', value: '0', name: 'zw.' },
];

function providerWith(get: jest.Mock): ShoperTaxTableProvider {
  return new ShoperTaxTableProvider({ get } as unknown as ShoperHttpClient);
}

describe('ShoperTaxTableProvider', () => {
  it('should key the table by tax_id', async () => {
    const get = jest.fn().mockResolvedValue({ status: 200, data: envelope(ROWS) });

    const table = await providerWith(get).get();

    expect(table.get('4')?.name).toBe('zw.');
    expect(get).toHaveBeenCalledWith('/taxes', { limit: 50, page: 1 });
  });

  it('should request the table once for many callers', async () => {
    const get = jest.fn().mockResolvedValue({ status: 200, data: envelope(ROWS) });
    const provider = providerWith(get);

    await Promise.all([provider.get(), provider.get()]);
    await provider.get();

    expect(get).toHaveBeenCalledTimes(1);
  });

  it('should read every page', async () => {
    const get = jest
      .fn()
      .mockResolvedValueOnce({ status: 200, data: envelope([ROWS[0]], { pages: 2, page: 1 }) })
      .mockResolvedValueOnce({ status: 200, data: envelope([ROWS[1]], { pages: 2, page: 2 }) });

    const table = await providerWith(get).get();

    expect([...table.keys()]).toEqual(['1', '4']);
  });

  it('should not cache a failure', async () => {
    const get = jest
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ status: 200, data: envelope(ROWS) });
    const provider = providerWith(get);

    await expect(provider.get()).rejects.toThrow('boom');
    await expect(provider.get()).resolves.toBeInstanceOf(Map);
  });
});
