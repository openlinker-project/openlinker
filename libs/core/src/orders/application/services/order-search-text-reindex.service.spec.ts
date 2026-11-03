/**
 * Order Search Text Reindex Service Unit Tests (#3507 G03-14)
 *
 * Pins: the pass is a no-op with PII storage on; with it off, only rows whose
 * stored text disagrees with the derivation are rewritten (so a second pass
 * over a clean table writes nothing); each rewrite carries the text it read
 * as its guard; paging follows the keyset cursor, stops on a short page, and
 * reports budget exhaustion with a resume cursor.
 *
 * @module libs/core/src/orders/application/services
 */
import type { OrderRecordRepositoryPort } from '../../domain/ports/order-record-repository.port';
import type { OrderSearchTextReindexRow } from '../../domain/types/order-search-text-reindex.types';
import {
  ORDER_SEARCH_TEXT_REINDEX_MAX_PAGES_PER_RUN,
  ORDER_SEARCH_TEXT_REINDEX_PAGE_SIZE,
  OrderSearchTextReindexService,
} from './order-search-text-reindex.service';

function row(
  internalOrderId: string,
  searchText: string,
  snapshot: Record<string, unknown> = {
    orderNumber: 'OL-1',
    customerEmail: 'anna@example.test',
    billingAddress: { firstName: 'Anna', lastName: 'Nowak' },
    items: [{ sku: 'SKU-1' }],
  }
): OrderSearchTextReindexRow {
  return { internalOrderId, orderSnapshot: snapshot, searchText };
}

function fullPage(prefix: string, searchText: string): OrderSearchTextReindexRow[] {
  return Array.from({ length: ORDER_SEARCH_TEXT_REINDEX_PAGE_SIZE }, (_, i) =>
    row(`${prefix}-${String(i).padStart(4, '0')}`, searchText)
  );
}

describe('OrderSearchTextReindexService', () => {
  const originalStorePii = process.env.OL_STORE_PII;
  let repository: {
    findSearchTextReindexPage: jest.Mock<Promise<OrderSearchTextReindexRow[]>, [string | null, number]>;
    rewriteSearchText: jest.Mock;
  };
  let service: OrderSearchTextReindexService;

  beforeEach(() => {
    process.env.OL_STORE_PII = 'false';
    repository = {
      findSearchTextReindexPage: jest.fn().mockResolvedValue([]),
      rewriteSearchText: jest.fn(
        (rewrites: readonly unknown[]): Promise<number> => Promise.resolve(rewrites.length)
      ),
    };
    service = new OrderSearchTextReindexService(
      repository as unknown as OrderRecordRepositoryPort
    );
  });

  afterEach(() => {
    if (originalStorePii === undefined) {
      delete process.env.OL_STORE_PII;
    } else {
      process.env.OL_STORE_PII = originalStorePii;
    }
  });

  it('should skip without reading order_records when OL_STORE_PII is on', async () => {
    process.env.OL_STORE_PII = 'true';

    const result = await service.runOnce(null);

    expect(result).toEqual({ status: 'skipped-pii-stored' });
    expect(repository.findSearchTextReindexPage).not.toHaveBeenCalled();
  });

  it('should skip when OL_STORE_PII is unset, because the flag defaults to on', async () => {
    delete process.env.OL_STORE_PII;

    const result = await service.runOnce(null);

    expect(result).toEqual({ status: 'skipped-pii-stored' });
  });

  it('should rewrite a row still carrying a name and email when PII is not stored', async () => {
    repository.findSearchTextReindexPage.mockResolvedValueOnce([
      row('ol_order_a', 'ol-1 anna@example.test anna nowak sku-1'),
    ]);

    const result = await service.runOnce(null);

    expect(repository.rewriteSearchText).toHaveBeenCalledWith([
      {
        internalOrderId: 'ol_order_a',
        expectedSearchText: 'ol-1 anna@example.test anna nowak sku-1',
        searchText: 'ol-1 sku-1',
      },
    ]);
    expect(result).toEqual({
      status: 'completed',
      scanned: 1,
      rewritten: 1,
      budgetExhausted: false,
      nextCursor: null,
    });
  });

  it('should write nothing when every row already matches the derivation', async () => {
    repository.findSearchTextReindexPage.mockResolvedValueOnce([
      row('ol_order_a', 'ol-1 sku-1'),
      row('ol_order_b', 'ol-1 sku-1'),
    ]);

    const result = await service.runOnce(null);

    expect(repository.rewriteSearchText).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'completed', scanned: 2, rewritten: 0 });
  });

  it('should repair a G03-1 row whose text was never written when PII is not stored', async () => {
    repository.findSearchTextReindexPage.mockResolvedValueOnce([row('ol_order_a', '')]);

    await service.runOnce(null);

    expect(repository.rewriteSearchText).toHaveBeenCalledWith([
      { internalOrderId: 'ol_order_a', expectedSearchText: '', searchText: 'ol-1 sku-1' },
    ]);
  });

  it('should report only the rows the guarded write actually changed when a concurrent writer won', async () => {
    repository.findSearchTextReindexPage.mockResolvedValueOnce([
      row('ol_order_a', 'ol-1 anna nowak sku-1'),
      row('ol_order_b', 'ol-1 anna nowak sku-1'),
    ]);
    repository.rewriteSearchText.mockResolvedValueOnce(1);

    const result = await service.runOnce(null);

    expect(result).toMatchObject({ scanned: 2, rewritten: 1 });
  });

  it('should resume from the given cursor and advance it by the last id of each full page', async () => {
    repository.findSearchTextReindexPage
      .mockResolvedValueOnce(fullPage('ol_order_a', 'ol-1 sku-1'))
      .mockResolvedValueOnce([row('ol_order_b', 'ol-1 sku-1')]);

    const result = await service.runOnce('ol_order_0');

    expect(repository.findSearchTextReindexPage.mock.calls).toEqual([
      ['ol_order_0', ORDER_SEARCH_TEXT_REINDEX_PAGE_SIZE],
      [`ol_order_a-${String(ORDER_SEARCH_TEXT_REINDEX_PAGE_SIZE - 1).padStart(4, '0')}`, ORDER_SEARCH_TEXT_REINDEX_PAGE_SIZE],
    ]);
    expect(result).toMatchObject({
      scanned: ORDER_SEARCH_TEXT_REINDEX_PAGE_SIZE + 1,
      budgetExhausted: false,
      nextCursor: null,
    });
  });

  it('should stop after the page budget and return a resume cursor when the table is larger', async () => {
    repository.findSearchTextReindexPage.mockImplementation(() =>
      Promise.resolve(
        fullPage(
          `ol_order_${String(repository.findSearchTextReindexPage.mock.calls.length).padStart(3, '0')}`,
          'ol-1 sku-1'
        )
      )
    );

    const result = await service.runOnce(null);

    expect(repository.findSearchTextReindexPage).toHaveBeenCalledTimes(
      ORDER_SEARCH_TEXT_REINDEX_MAX_PAGES_PER_RUN
    );
    expect(result).toMatchObject({
      status: 'completed',
      scanned: ORDER_SEARCH_TEXT_REINDEX_MAX_PAGES_PER_RUN * ORDER_SEARCH_TEXT_REINDEX_PAGE_SIZE,
      budgetExhausted: true,
    });
    expect(result.status === 'completed' && result.nextCursor).toBe(
      `ol_order_${String(ORDER_SEARCH_TEXT_REINDEX_MAX_PAGES_PER_RUN).padStart(3, '0')}-${String(
        ORDER_SEARCH_TEXT_REINDEX_PAGE_SIZE - 1
      ).padStart(4, '0')}`
    );
  });
});
