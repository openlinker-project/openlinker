/**
 * PrestaShop Inventory Master Adapter - Bulk Read Tests (#2648)
 *
 * Pins the REQUEST COUNT of a swept page. A throughput change with no
 * request-count test silently regresses: every read on this path is served from
 * a memo, so a reintroduced per-product read still produces correct stock and
 * only shows up as a slower sweep.
 *
 * It also pins the two filter properties that cost real incidents on the
 * catalogue side of this pattern - a pipe-joined OR list and an explicit sort -
 * by running the captured filters through the REAL query builder rather than
 * asserting the shape of a mock's arguments.
 *
 * @module libs/integrations/prestashop/src/infrastructure/adapters/__tests__
 */
import { PrestashopInventoryMasterAdapter } from '../prestashop-inventory-master.adapter';
import { createMockHttpClient } from '../../../__tests__/mocks/mock-http-client.factory';
import { createMockIdentifierMapping } from '../../../__tests__/mocks/mock-identifier-mapping.factory';
import { createTestConnection } from '../../../__tests__/fixtures/connection.fixture';
import { PrestashopInventoryMapper } from '../../mappers/prestashop-inventory.mapper';
import { PrestashopQueryBuilder } from '../../http/prestashop-query.builder';
import { isBulkInventoryReader } from '@openlinker/core/inventory';
import type { PrestashopStockAvailable } from '../../mappers/prestashop.mapper.interface';
import type { IPrestashopWebserviceClient } from '../../http/prestashop-webservice.client.interface';
import type { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';

const PAGE_SIZE = 100;

const stockRow = (psProductId: string): PrestashopStockAvailable => ({
  id: `s-${psProductId}`,
  id_product: psProductId,
  id_product_attribute: '0',
  quantity: '7',
  out_of_stock: '0',
});

describe('PrestashopInventoryMasterAdapter bulk read (#2648)', () => {
  let adapter: PrestashopInventoryMasterAdapter;
  let httpClient: jest.Mocked<IPrestashopWebserviceClient>;
  let identifierMapping: jest.Mocked<IdentifierMappingPort>;
  let connection: ReturnType<typeof createTestConnection>;
  let internalIds: string[];

  /** `int-<n>` maps to PrestaShop product `<n>`, matching the id fixtures below. */
  const psIdOf = (internalId: string): string => internalId.replace('int-', '');

  beforeEach(() => {
    httpClient = createMockHttpClient();
    identifierMapping = createMockIdentifierMapping();
    connection = createTestConnection();
    internalIds = Array.from({ length: PAGE_SIZE }, (_, i) => `int-${String(i + 1)}`);

    identifierMapping.getExternalIds = jest
      .fn()
      .mockImplementation((_type: string, internalId: string) =>
        Promise.resolve([
          {
            entityType: 'Product',
            connectionId: connection.id,
            externalId: psIdOf(internalId),
          },
        ])
      );
    identifierMapping.getOrCreateInternalId = jest
      .fn()
      .mockImplementation((type: string, externalId: string) =>
        Promise.resolve(`ol-${type}-${externalId}`)
      );

    adapter = new PrestashopInventoryMasterAdapter(
      httpClient,
      identifierMapping,
      new PrestashopInventoryMapper(),
      connection
    );
  });

  /**
   * One `stock_availables` row per product. The paged helper stops once a page
   * comes back short, so a stub answering everything on the first read costs
   * one call.
   */
  const stubBulkStockRead = (psProductIds: readonly string[]): void => {
    httpClient.listResources = jest
      .fn()
      .mockImplementation((resource: string, _filters: unknown, _limit?: number, offset?: number) => {
        if (resource !== 'stock_availables') {
          return Promise.resolve([]);
        }
        return Promise.resolve((offset ?? 0) === 0 ? psProductIds.map(stockRow) : []);
      });
    httpClient.getResource = jest.fn().mockResolvedValue({ id: '1' });
  };

  it('should declare the bulk-read rung', () => {
    expect(isBulkInventoryReader(adapter)).toBe(true);
  });

  it('should read a page of 100 products in 2 collection reads and then serve every listInventory from the memo', async () => {
    const psProductIds = internalIds.map(psIdOf);
    stubBulkStockRead(psProductIds);

    await adapter.prefetchInventory(internalIds);

    // The first page came back exactly full (100 rows at PrestaShop's page
    // size), so the paged helper confirms the end with one empty read.
    expect(httpClient.listResources).toHaveBeenCalledTimes(2);

    for (const internalId of internalIds) {
      const inventories = await adapter.listInventory(internalId);
      expect(inventories).toHaveLength(1);
      expect(inventories[0].available).toBe(7);
    }

    // The whole page of stock, with no further HTTP at all - 2 requests where
    // the per-product fan-out spent 100.
    expect(httpClient.listResources).toHaveBeenCalledTimes(2);
    expect(httpClient.getResource).not.toHaveBeenCalled();
  });

  /**
   * The mock returns whatever it is told regardless of the filter, so a
   * count-and-shape assertion cannot see a wrong query. This one runs the
   * captured filters through the real builder and reads the string PrestaShop
   * would receive.
   */
  it('should emit a pipe-separated id filter and an explicit sort, never a comma range', async () => {
    stubBulkStockRead(['3', '9', '41']);

    await adapter.prefetchInventory(['int-3', 'int-9', 'int-41']);

    const call = httpClient.listResources.mock.calls.find(
      ([resource]) => resource === 'stock_availables'
    );
    const query = PrestashopQueryBuilder.buildQueryWithPagination(
      'stock_availables',
      call?.[1] as Parameters<typeof PrestashopQueryBuilder.buildQueryWithPagination>[1],
      undefined,
      call?.[2],
      call?.[3]
    );

    // A comma is a RANGE: `[3,41]` would answer for products 3 to 41 and for
    // nothing else, so every id outside the span would be memoized as having no
    // stock and published at 0.
    expect(query).toContain('filter[id_product]=[3|9|41]');
    expect(query).not.toContain('filter[id_product]=[3,9,41]');
    // Without a sort, offset paging trusts whatever order MySQL returns, so two
    // pages can overlap or leave a hole.
    expect(query).toContain('sort=[id_ASC]');
  });

  it('should leave the memo absent for an id the shop has no mapping for, so its own read still runs', async () => {
    identifierMapping.getExternalIds = jest
      .fn()
      .mockImplementation((_type: string, internalId: string) =>
        Promise.resolve(
          internalId === 'int-3'
            ? [{ entityType: 'Product', connectionId: connection.id, externalId: '3' }]
            : []
        )
      );
    stubBulkStockRead(['3']);

    await adapter.prefetchInventory(['int-3', 'int-99']);

    // Only the mapped id reached the filter; the unmapped one was dropped
    // rather than failing the warm-up.
    const call = httpClient.listResources.mock.calls.find(
      ([resource]) => resource === 'stock_availables'
    );
    expect(call?.[1]).toEqual(expect.objectContaining({ custom: { id_product: ['3'] } }));

    // And the unmapped product still raises its own, better-classified error on
    // the per-product path rather than reading as "no stock".
    await expect(adapter.listInventory('int-99')).rejects.toThrow();
  });

  it('should degrade to per-product reads when the prefetch throws', async () => {
    httpClient.listResources = jest
      .fn()
      .mockRejectedValueOnce(new Error('shop down'))
      .mockImplementation((resource: string, _filters: unknown, _limit?: number, offset?: number) =>
        Promise.resolve(resource === 'stock_availables' && (offset ?? 0) === 0 ? [stockRow('3')] : [])
      );

    await adapter.prefetchInventory(['int-3']);

    const inventories = await adapter.listInventory('int-3');
    expect(inventories).toHaveLength(1);
    expect(inventories[0].available).toBe(7);
  });

  it('should do nothing for an empty page', async () => {
    stubBulkStockRead([]);

    await adapter.prefetchInventory([]);

    expect(httpClient.listResources).not.toHaveBeenCalled();
  });
});
