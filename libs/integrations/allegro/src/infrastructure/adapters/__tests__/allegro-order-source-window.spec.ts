/**
 * Allegro order window read tests (#4228): checkout-forms list paging.
 *
 * @module libs/integrations/allegro/src/infrastructure/adapters/__tests__
 */
import { AllegroOrderSourceAdapter } from '../allegro-order-source.adapter';
import type { IAllegroHttpClient } from '../../http/allegro-http-client.interface';
import { Connection } from '@openlinker/core/identifier-mapping';

describe('AllegroOrderSourceAdapter.listOrdersInWindow', () => {
  let adapter: AllegroOrderSourceAdapter;
  let httpClient: jest.Mocked<IAllegroHttpClient>;

  const forms = (n: number): unknown => ({
    checkoutForms: Array.from({ length: n }, (_, i) => ({
      id: `cf-${i}`,
      lineItems: [{ boughtAt: `2026-01-0${i + 1}T10:00:00Z` }],
    })),
  });
  const params = (): Record<string, string | number> =>
    (httpClient.get.mock.calls[0][1] as { queryParams: Record<string, string | number> })
      .queryParams;

  beforeEach(() => {
    httpClient = { get: jest.fn() } as unknown as jest.Mocked<IAllegroHttpClient>;
    const connection = new Connection(
      'c1',
      'allegro',
      'A',
      'active',
      {},
      'ref',
      new Date(),
      new Date(),
      undefined,
      ['OrderSource']
    );
    adapter = new AllegroOrderSourceAdapter('c1', httpClient, connection);
  });

  it('should sort oldest-first and bound by whole UTC days when dates are date-only', async () => {
    httpClient.get.mockResolvedValue({ data: forms(2) } as never);
    await adapter.listOrdersInWindow({
      from: '2026-01-01',
      to: '2026-01-31',
      direction: 'oldest-first',
      cursor: null,
      limit: 5,
    });
    expect(httpClient.get.mock.calls[0][0]).toBe('/order/checkout-forms');
    expect(params()).toEqual({
      'lineItems.boughtAt.gte': '2026-01-01T00:00:00.000Z',
      'lineItems.boughtAt.lte': '2026-01-31T23:59:59.999Z',
      sort: 'lineItems.boughtAt',
      limit: 5,
      offset: 0,
    });
  });

  it('should sort newest-first and pass full instants as they are', async () => {
    httpClient.get.mockResolvedValue({ data: forms(1) } as never);
    await adapter.listOrdersInWindow({
      from: '2026-01-01T08:00:00.000Z',
      to: '2026-01-02T08:00:00.000Z',
      direction: 'newest-first',
      cursor: null,
      limit: 5,
    });
    expect(params().sort).toBe('-lineItems.boughtAt');
    expect(params()['lineItems.boughtAt.gte']).toBe('2026-01-01T08:00:00.000Z');
    expect(params()['lineItems.boughtAt.lte']).toBe('2026-01-02T08:00:00.000Z');
  });

  it('should omit the lower bound and pin the upper bound to now when from and to are absent', async () => {
    httpClient.get.mockResolvedValue({ data: forms(2) } as never);
    const page = await adapter.listOrdersInWindow({
      direction: 'oldest-first',
      cursor: null,
      limit: 2,
    });
    expect(params()['lineItems.boughtAt.gte']).toBeUndefined();
    const upper = params()['lineItems.boughtAt.lte'] as string;
    expect(Number.isNaN(Date.parse(upper))).toBe(false);
    expect(page.nextCursor).toBe(`offset:2@${upper}`);
  });

  it('should advance the offset cursor and keep the pinned upper bound on the next page', async () => {
    httpClient.get.mockResolvedValue({ data: forms(3) } as never);
    await adapter.listOrdersInWindow({
      direction: 'oldest-first',
      cursor: 'offset:6@2026-03-01T00:00:00.000Z',
      limit: 3,
    });
    expect(params().offset).toBe(6);
    expect(params()['lineItems.boughtAt.lte']).toBe('2026-03-01T00:00:00.000Z');
  });

  it('should be done with a null cursor when the page is shorter than the limit', async () => {
    httpClient.get.mockResolvedValue({ data: forms(2) } as never);
    const page = await adapter.listOrdersInWindow({
      from: '2026-01-01',
      direction: 'oldest-first',
      cursor: null,
      limit: 5,
    });
    expect(page.done).toBe(true);
    expect(page.nextCursor).toBeNull();
    expect(page.items[0]).toMatchObject({
      externalOrderId: 'cf-0',
      eventType: 'created',
      occurredAt: '2026-01-01T10:00:00Z',
      eventKey: 'window:cf-0',
    });
  });

  it('should throw when the request fails', async () => {
    httpClient.get.mockRejectedValue(new Error('boom'));
    await expect(
      adapter.listOrdersInWindow({ direction: 'oldest-first', cursor: null, limit: 5 })
    ).rejects.toThrow('boom');
  });

  it('should throw on a malformed cursor', async () => {
    await expect(
      adapter.listOrdersInWindow({ direction: 'oldest-first', cursor: 'garbage', limit: 5 })
    ).rejects.toThrow('Invalid Allegro order window cursor');
  });
});
