/**
 * Unit tests for PrestashopPackResolver (#2598)
 *
 * Pins the two properties the inventory adapter relies on: the pack-id set is
 * read once per connection per TTL (so a sweep does not probe every product),
 * and a set that could not be read whole is reported as unknown rather than as
 * a partial set.
 */
import { PrestashopPackResolver } from '../prestashop-pack.resolver';
import type { IPrestashopWebserviceClient } from '../../http/prestashop-webservice.client.interface';

describe('PrestashopPackResolver', () => {
  let resolver: PrestashopPackResolver;
  let listResources: jest.Mock;
  let client: jest.Mocked<IPrestashopWebserviceClient>;

  function makeClient(pages: Array<Array<{ id: string }>>, shopDefault?: string): void {
    listResources = jest.fn(
      (resource: string, _filters: unknown, _limit?: number, offset?: number) => {
        if (resource === 'configurations') {
          return Promise.resolve(shopDefault === undefined ? [] : [{ value: shopDefault }]);
        }
        return Promise.resolve(pages[Math.floor((offset ?? 0) / 100)] ?? []);
      }
    );
    client = { listResources } as unknown as jest.Mocked<IPrestashopWebserviceClient>;
  }

  beforeEach(() => {
    resolver = new PrestashopPackResolver();
  });

  it('should read every page of the pack-id set', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({ id: String(index + 1) }));
    makeClient([firstPage, [{ id: '777' }]]);

    const packIds = await resolver.resolvePackIds('conn-1', client);

    expect(packIds?.size).toBe(101);
    expect(packIds?.has('777')).toBe(true);
    expect(listResources).toHaveBeenCalledTimes(2);
  });

  it('should read the set once per connection', async () => {
    makeClient([[{ id: '42' }]]);

    await resolver.resolvePackIds('conn-1', client);
    await resolver.resolvePackIds('conn-1', client);

    expect(listResources).toHaveBeenCalledTimes(1);
  });

  it('should re-read after clearCache for the affected connection only', async () => {
    makeClient([[{ id: '42' }]]);

    await resolver.resolvePackIds('conn-1', client);
    await resolver.resolvePackIds('conn-2', client);
    resolver.clearCache('conn-1');
    await resolver.resolvePackIds('conn-1', client);
    await resolver.resolvePackIds('conn-2', client);

    expect(listResources).toHaveBeenCalledTimes(3);
  });

  it('should report unknown rather than a partial set when the read is truncated', async () => {
    const fullPage = Array.from({ length: 100 }, (_, index) => ({ id: String(index + 1) }));
    // Never a short page, so the paged read exhausts its budget and refuses.
    makeClient(Array.from({ length: 600 }, () => fullPage));

    await expect(resolver.resolvePackIds('conn-1', client)).resolves.toBeNull();
  });

  it('should report unknown when the enumeration fails', async () => {
    client = {
      listResources: jest.fn().mockRejectedValue(new Error('403 forbidden')),
    } as unknown as jest.Mocked<IPrestashopWebserviceClient>;

    await expect(resolver.resolvePackIds('conn-1', client)).resolves.toBeNull();
  });

  it('should resolve the shop pack stock type and cache it', async () => {
    makeClient([[]], '1');

    await expect(resolver.resolveShopPackStockType('conn-1', client)).resolves.toBe(1);
    await expect(resolver.resolveShopPackStockType('conn-1', client)).resolves.toBe(1);

    const calls = listResources.mock.calls as Array<[string, ...unknown[]]>;
    expect(calls.filter((call) => call[0] === 'configurations')).toHaveLength(1);
  });

  it('should report null when the shop pack stock type is absent', async () => {
    makeClient([[]]);

    await expect(resolver.resolveShopPackStockType('conn-1', client)).resolves.toBeNull();
  });
});
