/**
 * PrestaShop Paged Read Tests
 *
 * The property under test is the one the defect broke: a result set larger than
 * one page comes back complete, or the read fails loudly. A short answer is
 * never handed back as authoritative (#2608).
 *
 * @module libs/integrations/prestashop/src/infrastructure/http/__tests__
 */
import { PrestashopTruncatedReadException } from '../../../domain/exceptions/prestashop-truncated-read.exception';
import type { IPrestashopWebserviceClient } from '../prestashop-webservice.client.interface';
import {
  PRESTASHOP_PAGE_SIZE,
  findAcrossPrestashopPages,
  findAcrossPrestashopResourcePages,
  readAllPrestashopPages,
  readAllPrestashopResourcePages,
} from '../prestashop-paged-read';

interface Row {
  id: number;
}

function rows(from: number, count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({ id: from + i }));
}

/** A shop holding `total` rows and honouring the paging clause. */
function shopWith(total: number): jest.Mock<Promise<Row[]>, [number, number]> {
  return jest.fn((limit: number, offset: number) =>
    Promise.resolve(rows(offset, Math.max(0, Math.min(limit, total - offset))))
  );
}

const CTX = { resource: 'order_details', connectionId: 'conn-1' };

describe('readAllPrestashopPages', () => {
  it('should return every row when the collection spans several pages', async () => {
    const read = shopWith(250);

    const result = await readAllPrestashopPages<Row>(read, CTX);

    expect(result).toHaveLength(250);
    expect(result[249].id).toBe(249);
    expect(read).toHaveBeenCalledTimes(3);
    expect(read).toHaveBeenNthCalledWith(2, PRESTASHOP_PAGE_SIZE, PRESTASHOP_PAGE_SIZE);
  });

  it('should read one extra page when the collection is an exact multiple of the page size', async () => {
    const read = shopWith(PRESTASHOP_PAGE_SIZE);

    const result = await readAllPrestashopPages<Row>(read, CTX);

    expect(result).toHaveLength(PRESTASHOP_PAGE_SIZE);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('should cost a single request when the collection fits in one page', async () => {
    const read = shopWith(7);

    await expect(readAllPrestashopPages<Row>(read, CTX)).resolves.toHaveLength(7);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('should throw rather than return a truncated result when the page budget runs out', async () => {
    const read = jest.fn((limit: number) => Promise.resolve(rows(0, limit)));

    await expect(readAllPrestashopPages<Row>(read, { ...CTX, maxRows: 3 * PRESTASHOP_PAGE_SIZE })).rejects.toBeInstanceOf(
      PrestashopTruncatedReadException
    );
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('should throw when the shop ignores the paging clause and keeps answering the same full page', async () => {
    const firstPage = rows(0, PRESTASHOP_PAGE_SIZE);
    const read = jest.fn(() => Promise.resolve(firstPage));

    await expect(
      readAllPrestashopPages<Row>(read, { ...CTX, maxRows: 5 * PRESTASHOP_PAGE_SIZE })
    ).rejects.toMatchObject({ resource: 'order_details', connectionId: 'conn-1' });
  });
});

describe('findAcrossPrestashopPages', () => {
  it('should find a row that lives past the first page', async () => {
    const read = shopWith(250);

    const match = await findAcrossPrestashopPages<Row>(read, (row) => row.id === 217, CTX);

    expect(match).toEqual({ id: 217 });
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('should stop at the page holding the match', async () => {
    const read = shopWith(500);

    await findAcrossPrestashopPages<Row>(read, (row) => row.id === 5, CTX);

    expect(read).toHaveBeenCalledTimes(1);
  });

  it('should answer null only after seeing the end of the collection', async () => {
    const read = shopWith(150);

    await expect(
      findAcrossPrestashopPages<Row>(read, (row) => row.id === 9999, CTX)
    ).resolves.toBeNull();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('should throw rather than report absence when the page budget runs out', async () => {
    const read = jest.fn((limit: number, offset: number) => Promise.resolve(rows(offset, limit)));

    await expect(
      findAcrossPrestashopPages<Row>(read, (row) => row.id === -1, { ...CTX, maxRows: 4 * PRESTASHOP_PAGE_SIZE })
    ).rejects.toBeInstanceOf(PrestashopTruncatedReadException);
    expect(read).toHaveBeenCalledTimes(4);
  });
});

/**
 * The resource helpers add the two things a hand-built reader kept forgetting:
 * the connection's own page size, and an order without which offset paging has
 * no tiling guarantee at all (#2608 review).
 */
describe('readAllPrestashopResourcePages', () => {
  function clientWith(
    total: number,
    pageSize?: number
  ): { client: IPrestashopWebserviceClient; listResources: jest.Mock } {
    const listResources = jest.fn(
      (_resource: string, _filters: unknown, limit?: number, offset?: number) =>
        Promise.resolve(rows(offset ?? 0, Math.max(0, Math.min(limit ?? 0, total - (offset ?? 0)))))
    );

    const client = {
      listResources,
      getPageSize: pageSize === undefined ? undefined : jest.fn(() => pageSize),
    } as unknown as IPrestashopWebserviceClient;

    return { client, listResources };
  }

  it('should read a big collection in one request when the connection allows a big page', async () => {
    const { client, listResources } = clientWith(600, 1000);

    const result = await readAllPrestashopResourcePages<Row>(client, 'combinations', undefined, {
      connectionId: 'conn-1',
    });

    expect(result).toHaveLength(600);
    expect(listResources).toHaveBeenCalledTimes(1);
    expect(listResources).toHaveBeenCalledWith('combinations', expect.anything(), 1000, 0);
  });

  it('should honour a page size an operator lowered', async () => {
    const { client, listResources } = clientWith(30, 10);

    await readAllPrestashopResourcePages<Row>(client, 'addresses', undefined, {
      connectionId: 'conn-1',
    });

    expect(listResources).toHaveBeenNthCalledWith(1, 'addresses', expect.anything(), 10, 0);
    expect(listResources).toHaveBeenCalledTimes(4);
  });

  it('should fall back to the shop default when the client reports no page size', async () => {
    const { client, listResources } = clientWith(10);

    await readAllPrestashopResourcePages<Row>(client, 'addresses', undefined, {
      connectionId: 'conn-1',
    });

    expect(listResources).toHaveBeenCalledWith(
      'addresses',
      expect.anything(),
      PRESTASHOP_PAGE_SIZE,
      0
    );
  });

  it('should sort by id so the pages tile the collection', async () => {
    const { client, listResources } = clientWith(5, 10);

    await readAllPrestashopResourcePages<Row>(
      client,
      'tax_rules',
      { custom: { id_tax_rules_group: 3 } },
      { connectionId: 'conn-1' }
    );

    expect(listResources).toHaveBeenCalledWith(
      'tax_rules',
      { custom: { id_tax_rules_group: 3 }, sort: ['id_ASC'] },
      10,
      0
    );
  });

  it('should keep an order the caller asked for', async () => {
    const { client, listResources } = clientWith(5, 10);

    await readAllPrestashopResourcePages<Row>(
      client,
      'orders',
      { sort: ['date_upd_ASC'] },
      { connectionId: 'conn-1' }
    );

    expect(listResources).toHaveBeenCalledWith('orders', { sort: ['date_upd_ASC'] }, 10, 0);
  });

  it('should express the budget in rows, so a bigger page does not raise the ceiling', async () => {
    const { client, listResources } = clientWith(100000, 1000);

    await expect(
      readAllPrestashopResourcePages<Row>(client, 'categories', undefined, {
        connectionId: 'conn-1',
        maxRows: 5000,
      })
    ).rejects.toBeInstanceOf(PrestashopTruncatedReadException);

    expect(listResources).toHaveBeenCalledTimes(5);
  });

  it('should scan for a match through the same page size and order', async () => {
    const { client, listResources } = clientWith(30, 10);

    const match = await findAcrossPrestashopResourcePages<Row>(
      client,
      'product_features',
      undefined,
      (row) => row.id === 12,
      { connectionId: 'conn-1' }
    );

    expect(match).toEqual({ id: 12 });
    expect(listResources).toHaveBeenCalledWith(
      'product_features',
      { sort: ['id_ASC'] },
      10,
      expect.any(Number)
    );
  });
});
