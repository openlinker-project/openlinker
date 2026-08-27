/**
 * PrestaShop Product Master Adapter - Bulk Read Tests (#2593)
 *
 * Pins the REQUEST COUNT of a swept page. A throughput change with no
 * request-count test silently regresses: every read on this path is served from
 * a memo, so a reintroduced per-product fetch still produces correct data and
 * only shows up as a slower catalogue.
 *
 * @module libs/integrations/prestashop/src/infrastructure/adapters/__tests__
 */
import { PrestashopProductMasterAdapter } from '../prestashop-product-master.adapter';
import { createMockHttpClient } from '../../../__tests__/mocks/mock-http-client.factory';
import { createMockIdentifierMapping } from '../../../__tests__/mocks/mock-identifier-mapping.factory';
import { createTestConnection } from '../../../__tests__/fixtures/connection.fixture';
import { PrestashopProductMapper } from '../../mappers/prestashop-product.mapper';
import { PrestashopQueryBuilder } from '../../http/prestashop-query.builder';
import { isBulkProductReader } from '@openlinker/core/products';
import type {
  PrestashopProduct,
  PrestashopCombination,
} from '../../mappers/prestashop.mapper.interface';
import type { IPrestashopWebserviceClient } from '../../http/prestashop-webservice.client.interface';
import type { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';

const PAGE_SIZE = 100;

const productRow = (id: number): PrestashopProduct =>
  ({
    id: String(id),
    name: { language: [{ '#text': `Product ${String(id)}`, '@_id': '1' }] },
    reference: `SKU-${String(id)}`,
    price: '19.99',
    active: '1',
  }) as unknown as PrestashopProduct;

describe('PrestashopProductMasterAdapter bulk read (#2593)', () => {
  let adapter: PrestashopProductMasterAdapter;
  let httpClient: jest.Mocked<IPrestashopWebserviceClient>;
  let identifierMapping: jest.Mocked<IdentifierMappingPort>;
  let connection: ReturnType<typeof createTestConnection>;
  let externalIds: string[];

  beforeEach(() => {
    httpClient = createMockHttpClient();
    identifierMapping = createMockIdentifierMapping();
    connection = createTestConnection();
    externalIds = Array.from({ length: PAGE_SIZE }, (_, i) => String(i + 1));

    identifierMapping.batchGetOrCreateInternalIds = jest
      .fn()
      .mockImplementation((requests: { externalId: string }[]) =>
        Promise.resolve(
          new Map(requests.map((r) => [`${r.externalId}:${connection.id}`, `int-${r.externalId}`]))
        )
      );
    identifierMapping.getExternalIds = jest
      .fn()
      .mockImplementation((_type: string, internalId: string) =>
        Promise.resolve([
          {
            entityType: 'Product',
            connectionId: connection.id,
            externalId: internalId.replace('int-', ''),
          },
        ])
      );

    adapter = new PrestashopProductMasterAdapter(
      httpClient,
      identifierMapping,
      new PrestashopProductMapper({ storefrontBaseUrl: 'https://shop.test' }),
      connection
    );
  });

  /**
   * `products` answers the whole page in one read (the mock has no page cap on
   * that resource); `combinations` is read through the paged helper, which stops
   * once a page comes back short.
   */
  const stubBulkReads = (combinations: PrestashopCombination[]): void => {
    httpClient.listResources = jest
      .fn()
      .mockImplementation((resource: string, _filters: unknown, _limit?: number, offset?: number) => {
        if (resource === 'products') {
          return Promise.resolve(externalIds.map((id) => productRow(Number(id))));
        }
        if (resource === 'combinations') {
          return Promise.resolve((offset ?? 0) === 0 ? combinations : []);
        }
        return Promise.resolve([]);
      });
    httpClient.getResource = jest.fn().mockImplementation((_resource: string, id: string) =>
      Promise.resolve(productRow(Number(id)))
    );
  };

  it('should declare the bulk-read rung', () => {
    expect(isBulkProductReader(adapter)).toBe(true);
  });

  it('should hydrate 100 products and their variants in 2 collection reads and no per-product fetch', async () => {
    stubBulkReads([]);

    await adapter.prefetchProducts(externalIds);

    // One `products` read plus one `combinations` read. The combinations read
    // came back short, so the paged helper stopped there.
    expect(httpClient.listResources).toHaveBeenCalledTimes(2);
    expect(httpClient.getResource).not.toHaveBeenCalled();

    for (const externalId of externalIds) {
      await adapter.getProduct(`int-${externalId}`);
      await adapter.getProductVariants(`int-${externalId}`);
    }

    // The whole page, product bodies and variants, with no further HTTP at all.
    expect(httpClient.getResource).not.toHaveBeenCalled();
    expect(httpClient.listResources).toHaveBeenCalledTimes(2);
  });

  it('should serve prefetched combinations instead of one read per product', async () => {
    const combinations = externalIds.map(
      (id, index) =>
        ({ id: String(1000 + index), id_product: id }) as unknown as PrestashopCombination
    );
    stubBulkReads(combinations);
    identifierMapping.batchGetOrCreateInternalIds = jest
      .fn()
      .mockImplementation((requests: { externalId: string }[]) =>
        Promise.resolve(
          new Map(requests.map((r) => [`${r.externalId}:${connection.id}`, `int-${r.externalId}`]))
        )
      );

    await adapter.prefetchProducts(externalIds);
    const variants = await adapter.getProductVariants('int-7');

    expect(variants).toHaveLength(1);
    // Two `combinations` reads for the whole page of 100 - the first came back
    // exactly full, so the paged helper confirms the end with one empty read.
    // Either way it is a per-PAGE cost, not the 100 per-product reads it
    // replaces (#2608 owns the pagination itself).
    const combinationReads = httpClient.listResources.mock.calls.filter(
      ([resource]) => resource === 'combinations'
    );
    expect(combinationReads).toHaveLength(2);
  });

  it('should ask for the ids as a pipe-separated OR list, sorted, in one page', async () => {
    stubBulkReads([]);

    await adapter.prefetchProducts(['3', '9']);

    const call = httpClient.listResources.mock.calls.find(([resource]) => resource === 'products');
    expect(call?.[1]).toEqual(
      expect.objectContaining({ ids: ['3', '9'], sort: ['id_ASC'] })
    );
    // Limit is the id count, so the WebService page size cannot cut the tail.
    expect(call?.[2]).toBe(2);
  });

  /**
   * The mock returns whatever it is told regardless of the filter, so a
   * count-and-shape assertion cannot see a wrong query. This one runs the
   * captured filters through the real builder and reads the string PrestaShop
   * would receive.
   */
  it('should emit a pipe-separated combinations filter, never a comma range', async () => {
    stubBulkReads([]);

    await adapter.prefetchProducts(['3', '9', '41']);

    const call = httpClient.listResources.mock.calls.find(
      ([resource]) => resource === 'combinations'
    );
    const query = PrestashopQueryBuilder.buildQueryWithPagination(
      'combinations',
      call?.[1] as Parameters<typeof PrestashopQueryBuilder.buildQueryWithPagination>[1],
      undefined,
      call?.[2] as number | undefined,
      call?.[3] as number | undefined
    );

    // A comma is a RANGE: `[3,41]` would answer for products 3 to 41 and for
    // nothing else, so the ids outside the span would be cached as having no
    // variants and staled.
    expect(query).toContain('filter[id_product]=[3|9|41]');
    expect(query).not.toContain('filter[id_product]=[3,9,41]');
  });

  it('should leave the combinations cache absent for an id the shop did not return', async () => {
    httpClient.listResources = jest
      .fn()
      .mockImplementation((resource: string) =>
        Promise.resolve(resource === 'products' ? [productRow(3)] : [])
      );
    httpClient.getResource = jest
      .fn()
      .mockImplementation((_resource: string, id: string) => Promise.resolve(productRow(Number(id))));

    await adapter.prefetchProducts(['3', '9']);

    // Product 9 was never confirmed, so "no variants" is not a claim this
    // prefetch may make: the per-product read decides.
    await adapter.getProductVariants('int-9');
    expect(httpClient.listResources).toHaveBeenCalledWith(
      'combinations',
      { custom: { id_product: '9' } },
      expect.anything(),
      expect.anything()
    );
  });

  it('should fall back to per-product reads when the bulk read fails', async () => {
    httpClient.listResources = jest.fn().mockRejectedValue(new Error('shop down'));
    httpClient.getResource = jest.fn().mockResolvedValue(productRow(1));

    await expect(adapter.prefetchProducts(['1'])).resolves.toBeUndefined();

    await adapter.getProduct('int-1');
    expect(httpClient.getResource).toHaveBeenCalledWith('products', '1');
  });

  it('should not read anything for an empty batch', async () => {
    stubBulkReads([]);

    await adapter.prefetchProducts([]);

    expect(httpClient.listResources).not.toHaveBeenCalled();
  });
});
