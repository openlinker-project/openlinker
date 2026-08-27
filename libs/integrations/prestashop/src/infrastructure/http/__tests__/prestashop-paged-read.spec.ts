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
import {
  PRESTASHOP_PAGE_SIZE,
  findAcrossPrestashopPages,
  readAllPrestashopPages,
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

    await expect(readAllPrestashopPages<Row>(read, { ...CTX, maxPages: 3 })).rejects.toBeInstanceOf(
      PrestashopTruncatedReadException
    );
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('should throw when the shop ignores the paging clause and keeps answering the same full page', async () => {
    const firstPage = rows(0, PRESTASHOP_PAGE_SIZE);
    const read = jest.fn(() => Promise.resolve(firstPage));

    await expect(
      readAllPrestashopPages<Row>(read, { ...CTX, maxPages: 5 })
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
      findAcrossPrestashopPages<Row>(read, (row) => row.id === -1, { ...CTX, maxPages: 4 })
    ).rejects.toBeInstanceOf(PrestashopTruncatedReadException);
    expect(read).toHaveBeenCalledTimes(4);
  });
});
