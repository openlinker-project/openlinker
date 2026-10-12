import { ShoperApiError } from '../../../domain/exceptions/shoper-api.error';
import {
  LIVE_OPTION_COLOUR,
  LIVE_OPTION_VALUES,
  envelope,
} from '../../__tests__/shoper-test-data';
import type { ShoperHttpClient } from '../../http/shoper-http-client';
import { ShoperOptionTableProvider } from '../shoper-option-table.provider';

function shop(routes: {
  option?: unknown;
  values?: unknown;
  optionError?: Error;
}): { provider: ShoperOptionTableProvider; get: jest.Mock } {
  const get = jest.fn((path: string) => {
    if (path.startsWith('/options/')) {
      return routes.optionError
        ? Promise.reject(routes.optionError)
        : Promise.resolve({ status: 200, data: routes.option ?? LIVE_OPTION_COLOUR });
    }
    return Promise.resolve({ status: 200, data: routes.values ?? envelope(LIVE_OPTION_VALUES) });
  });
  return { provider: new ShoperOptionTableProvider({ get } as unknown as ShoperHttpClient), get };
}

describe('ShoperOptionTableProvider', () => {
  it('should read an option and key its values by ovalue_id', async () => {
    const { provider, get } = shop({});

    const entry = await provider.get('10');

    expect(entry?.option.translations.pl_PL.name).toBe('Kolor');
    expect(entry?.values.get('76')?.translations.pl_PL.value).toBe('Shoper blue');
    expect(get).toHaveBeenCalledWith('/options/10');
    expect(get).toHaveBeenCalledWith('/option-values', {
      'filters[option_id]': '10',
      order: 'ovalue_id ASC',
      limit: 50,
      page: 1,
    });
  });

  it('should read an option once for many callers', async () => {
    const { provider, get } = shop({});

    await Promise.all([provider.get('10'), provider.get('10')]);
    await provider.get('10');

    expect(get.mock.calls.filter(([path]) => path === '/options/10')).toHaveLength(1);
  });

  it('should read every page of values', async () => {
    const get = jest
      .fn()
      .mockResolvedValueOnce({ status: 200, data: LIVE_OPTION_COLOUR })
      .mockResolvedValueOnce({ status: 200, data: envelope([LIVE_OPTION_VALUES[0]], { pages: 2, page: 1 }) })
      .mockResolvedValueOnce({ status: 200, data: envelope([LIVE_OPTION_VALUES[1]], { pages: 2, page: 2 }) });
    const provider = new ShoperOptionTableProvider({ get } as unknown as ShoperHttpClient);

    const entry = await provider.get('10');

    expect([...(entry?.values.keys() ?? [])]).toEqual(['68', '76']);
  });

  it('should answer null for an option the shop does not have', async () => {
    const { provider } = shop({ optionError: new ShoperApiError(404, 'invalid_request') });

    await expect(provider.get('99')).resolves.toBeNull();
  });

  it('should answer null, trusting no value, when the values filter was not honoured', async () => {
    const { provider } = shop({
      values: envelope([{ ...LIVE_OPTION_VALUES[0] }, { ovalue_id: '5', option_id: '13', translations: {} }]),
    });

    await expect(provider.get('10')).resolves.toBeNull();
  });

  it('should not cache a transport failure', async () => {
    const get = jest
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ status: 200, data: LIVE_OPTION_COLOUR })
      .mockResolvedValueOnce({ status: 200, data: envelope(LIVE_OPTION_VALUES) });
    const provider = new ShoperOptionTableProvider({ get } as unknown as ShoperHttpClient);

    await expect(provider.get('10')).rejects.toThrow('boom');
    await expect(provider.get('10')).resolves.not.toBeNull();
  });
});
