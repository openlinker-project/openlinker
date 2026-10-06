import { ShoperApiError } from '../../../domain/exceptions/shoper-api.error';
import type { CachePort } from '@openlinker/shared';

import type { ShoperHttpClient } from '../../http/shoper-http-client';
import { ShoperOrderReferenceProvider } from '../shoper-order-reference.provider';

function envelope(list: readonly unknown[]): { status: number; data: unknown } {
  return { status: 200, data: { count: String(list.length), pages: 1, page: 1, list } };
}

function setup(get: jest.Mock): ShoperOrderReferenceProvider {
  return new ShoperOrderReferenceProvider({ get } as unknown as ShoperHttpClient);
}

const STATUSES = [
  { status_id: '1', type: '1', translations: { pl_PL: { name: 'złożone' } } },
  { status_id: '7', type: '3', translations: { pl_PL: { name: 'przesyłka wysłana' }, en_US: { name: ' ' } } },
  { status_id: '8', type: '4', translations: { pl_PL: { name: 'anulowane' }, en_US: { name: 'Cancelled' } } },
  { status_id: '12', type: null },
  { status_id: '13', type: '4' },
];

describe('ShoperOrderReferenceProvider', () => {
  it('should resolve a status id to its type and every non-blank label, and read the table once', async () => {
    const get = jest.fn().mockResolvedValue(envelope(STATUSES));
    const provider = setup(get);

    await expect(provider.getStatus('7')).resolves.toEqual({ type: 3, labels: ['przesyłka wysłana'] });
    await expect(provider.getStatus('8')).resolves.toEqual({ type: 4, labels: ['anulowane', 'Cancelled'] });
    await expect(provider.getStatus('13')).resolves.toEqual({ type: 4, labels: [] });
    await expect(provider.getStatus('99')).resolves.toBeNull();
    await expect(provider.getStatus('12')).resolves.toBeNull();

    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('/statuses', { order: 'status_id ASC', limit: 50, page: 1 });
  });

  it('should resolve a currency id to its upper-cased code', async () => {
    const get = jest.fn().mockResolvedValue(envelope([{ currency_id: '1', name: 'pln' }, { currency_id: '2', name: 'USD' }]));
    const provider = setup(get);

    await expect(provider.getCurrencyCode('1')).resolves.toBe('PLN');
    await expect(provider.getCurrencyCode('3')).resolves.toBeNull();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('should retry a failed table read instead of replaying the rejection', async () => {
    const get = jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(envelope(STATUSES));
    const provider = setup(get);

    await expect(provider.getStatus('7')).rejects.toThrow('boom');
    await expect(provider.getStatus('7')).resolves.toMatchObject({ type: 3 });
  });

  it('should read a shipping method name once per method', async () => {
    const get = jest.fn().mockResolvedValue({ status: 200, data: { shipping_id: '8', name: ' Odbiór osobisty ' } });
    const provider = setup(get);

    await expect(provider.getShippingName('8')).resolves.toBe('Odbiór osobisty');
    await provider.getShippingName('8');

    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('/shippings/8');
  });

  it('should report an unknown or unnamed shipping method as null, and rethrow anything else', async () => {
    const notFound = jest.fn().mockRejectedValue(new ShoperApiError(404, 'invalid_request', 'Resource not found'));
    const unnamed = jest.fn().mockResolvedValue({ status: 200, data: { shipping_id: '8', name: '  ' } });
    const broken = jest.fn().mockRejectedValue(new ShoperApiError(500));

    await expect(setup(notFound).getShippingName('99')).resolves.toBeNull();
    await expect(setup(unnamed).getShippingName('8')).resolves.toBeNull();
    await expect(setup(broken).getShippingName('8')).rejects.toBeInstanceOf(ShoperApiError);
  });

  describe('host cache', () => {
    const PREFIX = 'shoper:order-reference:conn-1:shop.example.pl';

    function withCache(get: jest.Mock, stored: Record<string, unknown> = {}): {
      provider: ShoperOrderReferenceProvider;
      cache: jest.Mocked<CachePort>;
    } {
      const cache = {
        get: jest.fn((key: string) => Promise.resolve(key in stored ? stored[key] : null)),
        set: jest.fn().mockResolvedValue(undefined),
      } as unknown as jest.Mocked<CachePort>;
      const provider = new ShoperOrderReferenceProvider({ get } as unknown as ShoperHttpClient, {
        cache,
        keyPrefix: PREFIX,
      });
      return { provider, cache };
    }

    it('should read the shop on a miss and store each table under a connection-scoped key with a TTL', async () => {
      const get = jest.fn().mockResolvedValue(envelope(STATUSES));
      const { provider, cache } = withCache(get);

      await provider.getStatus('7');

      expect(get).toHaveBeenCalledTimes(1);
      expect(cache.set).toHaveBeenCalledWith(
        `${PREFIX}:statuses`,
        expect.arrayContaining([['7', { type: 3, labels: ['przesyłka wysłana'] }]]),
        300,
      );
    });

    it('should skip the shop entirely on a hit, so a later job does not re-read the table', async () => {
      const get = jest.fn();
      const { provider } = withCache(get, {
        [`${PREFIX}:statuses`]: [['8', { type: 4, labels: ['anulowane'] }]],
        [`${PREFIX}:currencies`]: [['1', 'PLN']],
      });

      await expect(provider.getStatus('8')).resolves.toEqual({ type: 4, labels: ['anulowane'] });
      await expect(provider.getCurrencyCode('1')).resolves.toBe('PLN');

      expect(get).not.toHaveBeenCalled();
    });

    it.each([
      ['not an array', 'garbage'],
      ['an empty table', []],
      ['a malformed entry', [['7', { type: 'three', labels: [] }]]],
      ['an entry of the wrong arity', [['7']]],
    ])('should not trust a cached entry that is %s, and ask the shop instead', async (_name, bad) => {
      const get = jest.fn().mockResolvedValue(envelope(STATUSES));
      const { provider } = withCache(get, { [`${PREFIX}:statuses`]: bad });

      await expect(provider.getStatus('7')).resolves.toMatchObject({ type: 3 });
      expect(get).toHaveBeenCalledTimes(1);
    });

    it('should never store an empty table', async () => {
      const get = jest.fn().mockResolvedValue(envelope([]));
      const { provider, cache } = withCache(get);

      await expect(provider.getStatus('7')).resolves.toBeNull();

      expect(cache.set).not.toHaveBeenCalled();
    });

    it('should carry on when the cache itself fails, reading and writing', async () => {
      const get = jest.fn().mockResolvedValue(envelope(STATUSES));
      const { provider, cache } = withCache(get);
      cache.get.mockRejectedValue(new Error('redis down'));
      cache.set.mockRejectedValue(new Error('redis down'));

      await expect(provider.getStatus('7')).resolves.toMatchObject({ type: 3 });
    });

    it('should cache a shipping name per method, including an unknown one', async () => {
      const get = jest
        .fn()
        .mockResolvedValueOnce({ status: 200, data: { shipping_id: '8', name: 'Odbiór osobisty' } })
        .mockRejectedValueOnce(new ShoperApiError(404, 'invalid_request', 'Resource not found'));
      const { provider, cache } = withCache(get, { [`${PREFIX}:shipping:9`]: { name: 'Kurier' } });

      await expect(provider.getShippingName('8')).resolves.toBe('Odbiór osobisty');
      await expect(provider.getShippingName('9')).resolves.toBe('Kurier');
      await expect(provider.getShippingName('99')).resolves.toBeNull();

      expect(get).toHaveBeenCalledTimes(2);
      expect(cache.set).toHaveBeenCalledWith(`${PREFIX}:shipping:8`, { name: 'Odbiór osobisty' }, 300);
      expect(cache.set).toHaveBeenCalledWith(`${PREFIX}:shipping:99`, { name: null }, 300);
    });
  });
});
