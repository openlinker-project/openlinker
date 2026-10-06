import { ShoperApiError } from '../../../domain/exceptions/shoper-api.error';
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
});
