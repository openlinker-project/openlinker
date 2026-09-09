import type { IProductsService } from '@openlinker/core/products';
import type { StoredTaxRate } from '@openlinker/core/products';

import { OrderLineItem } from '../../domain/entities/order-line-item.entity';
import type { OrderLineItemRepositoryPort } from '../../domain/ports/order-line-item-repository.port';
import type { OrderRecordRepositoryPort } from '../../domain/ports/order-record-repository.port';
import type {
  NetExcludedOrderCandidate,
  NetExcludedOrderCandidatePage,
} from '../../domain/types/coverage-detection.types';
import { TaxCoverageDetectionService } from './tax-coverage-detection.service';
import { TaxCoveragePageCeilingExceededError } from '../../domain/exceptions/tax-coverage-page-ceiling-exceeded.error';

describe('TaxCoverageDetectionService (#2465)', () => {
  let service: TaxCoverageDetectionService;
  let recordRepository: jest.Mocked<
    Pick<OrderRecordRepositoryPort, 'findNetExcludedOrderCandidatesPage'>
  >;
  let lineItemRepository: jest.Mocked<Pick<OrderLineItemRepositoryPort, 'findByOrderIds'>>;
  let productsService: jest.Mocked<Pick<IProductsService, 'getEffectiveTaxRate'>>;

  const baseFilters = {
    from: new Date('2026-08-01T00:00:00.000Z'),
    to: new Date('2026-08-08T00:00:00.000Z'),
  };

  const candidate = (overrides: Partial<NetExcludedOrderCandidate>): NetExcludedOrderCandidate => ({
    internalOrderId: 'ol_order_1',
    sourceConnectionId: 'conn-1',
    placedAt: new Date('2026-08-02T00:00:00Z'),
    taxRateEra: null,
    ...overrides,
  });

  const makeLine = (overrides: Partial<OrderLineItem> = {}): OrderLineItem =>
    new OrderLineItem(
      overrides.id ?? 'line-1',
      overrides.orderRecordId ?? 'ol_order_1',
      overrides.lineNumber ?? 0,
      overrides.productId ?? 'ol_product_1',
      overrides.variantId ?? null,
      overrides.quantity ?? 1,
      overrides.unitPrice ?? 100,
      overrides.sourceConnectionId ?? 'conn-1',
      overrides.placedAt ?? new Date('2026-08-02T00:00:00Z'),
      overrides.createdAt ?? new Date('2026-08-02T00:00:00Z'),
      overrides.taxRate ?? null,
      overrides.taxSource ?? null,
      overrides.taxRateReadAt ?? null
    );

  const known = (code: string): StoredTaxRate => ({
    code,
    countryIso2: 'PL',
    readAt: new Date('2026-08-24T00:00:00Z'),
  });
  const noRate: StoredTaxRate = { code: null, countryIso2: 'PL', readAt: new Date('2026-08-24T00:00:00Z') };
  const notChecked: StoredTaxRate = { code: null, countryIso2: null, readAt: null };

  /**
   * Configure the batched `findByOrderIds` mock to answer with `lines` for
   * WHICHEVER order ids the service asks about — the direct counterpart of a
   * plain `findByOrderId.mockResolvedValue([...])`, for a single-candidate
   * test where the lines' own `orderRecordId` is not the thing under test.
   */
  const setLines = (...lines: OrderLineItem[]): void => {
    lineItemRepository.findByOrderIds.mockImplementation((ids: string[]) =>
      Promise.resolve(new Map(ids.map((id) => [id, lines])))
    );
  };

  /**
   * Group lines by their own `orderRecordId` into the `Map` shape
   * `findByOrderIds` returns — for a MULTI-order test, where which order owns
   * which line is exactly what is being asserted (#2826's batching/dedup).
   */
  const linesMap = (...lines: OrderLineItem[]): Map<string, OrderLineItem[]> => {
    const map = new Map<string, OrderLineItem[]>();
    for (const line of lines) {
      const existing = map.get(line.orderRecordId) ?? [];
      existing.push(line);
      map.set(line.orderRecordId, existing);
    }
    return map;
  };

  beforeEach(() => {
    recordRepository = { findNetExcludedOrderCandidatesPage: jest.fn() };
    lineItemRepository = { findByOrderIds: jest.fn().mockResolvedValue(new Map()) };
    productsService = { getEffectiveTaxRate: jest.fn() };

    service = new TaxCoverageDetectionService(
      recordRepository as unknown as OrderRecordRepositoryPort,
      lineItemRepository as unknown as OrderLineItemRepositoryPort,
      productsService as unknown as IProductsService
    );
  });

  /**
   * Configure `findNetExcludedOrderCandidatesPage` to answer with the WHOLE
   * given candidate set as one page, `nextCursor: null` (#2834) — the direct
   * counterpart of the pre-#2834 `findNetExcludedOrderCandidates.mockResolvedValue(
   * candidates)`, for every test in this file whose fixture population fits
   * comfortably under one page and is not itself testing pagination.
   */
  const mockSinglePage = (items: NetExcludedOrderCandidate[]): void => {
    recordRepository.findNetExcludedOrderCandidatesPage.mockResolvedValue({
      items,
      nextCursor: null,
    });
  };

  describe('classify', () => {
    it('reports tax-b for a non-pre-rollout candidate without touching line items or the catalogue', async () => {
      mockSinglePage([
        candidate({ internalOrderId: 'order-post-rollout', taxRateEra: null }),
      ]);

      const result = await service.classify(baseFilters, 'EUR');

      expect(result['tax-b']).toHaveLength(1);
      expect(result['tax-b'][0].internalOrderId).toBe('order-post-rollout');
      expect(result['tax-a']).toHaveLength(0);
      expect(result['tax-c']).toHaveLength(0);
      // The batched read is issued once per `classify()` call (#2826), so the
      // guard is that it carries NO order ids for a non-pre-rollout candidate
      // — `findByOrderIds([])` short-circuits before any query. Asserting the
      // method was never invoked would pin the call shape rather than the
      // "does no line-item work" contract the narrowing exists to keep.
      expect(lineItemRepository.findByOrderIds).toHaveBeenCalledWith([]);
    });

    it('reports tax-a when a pre-rollout order already has every line resolved (backfill already ran)', async () => {
      mockSinglePage([
        candidate({ internalOrderId: 'order-a', taxRateEra: 'pre-rollout' }),
      ]);
      setLines(
        makeLine({ orderRecordId: 'order-a', taxRate: '23' }),
      );

      const result = await service.classify(baseFilters, 'EUR');

      expect(result['tax-a']).toHaveLength(1);
      expect(result['tax-a'][0].internalOrderId).toBe('order-a');
      expect(productsService.getEffectiveTaxRate).not.toHaveBeenCalled();
    });

    it('reports tax-a when a pre-rollout order has an unresolved line that resolves live via the catalogue (the 31-row demo case)', async () => {
      mockSinglePage([
        candidate({ internalOrderId: 'order-a', taxRateEra: 'pre-rollout' }),
      ]);
      setLines(
        makeLine({ orderRecordId: 'order-a', productId: 'ol_product_x', taxRate: null }),
      );
      productsService.getEffectiveTaxRate.mockResolvedValue(known('23'));

      const result = await service.classify(baseFilters, 'EUR');

      expect(result['tax-a']).toHaveLength(1);
      expect(result['tax-b']).toHaveLength(0);
      expect(result['tax-c']).toHaveLength(0);
      expect(productsService.getEffectiveTaxRate).toHaveBeenCalledWith('ol_product_x', undefined);
    });

    it('reports tax-b when a pre-rollout order has an unresolved line the catalogue confirms carries no rate', async () => {
      mockSinglePage([
        candidate({ internalOrderId: 'order-b', taxRateEra: 'pre-rollout' }),
      ]);
      setLines(
        makeLine({ orderRecordId: 'order-b', taxRate: null }),
      );
      productsService.getEffectiveTaxRate.mockResolvedValue(noRate);

      const result = await service.classify(baseFilters, 'EUR');

      expect(result['tax-b']).toHaveLength(1);
      expect(result['tax-a']).toHaveLength(0);
      expect(result['tax-c']).toHaveLength(0);
    });

    it('reports tax-c when a pre-rollout order has an unresolved line the catalogue has never checked', async () => {
      mockSinglePage([
        candidate({ internalOrderId: 'order-c', taxRateEra: 'pre-rollout' }),
      ]);
      setLines(
        makeLine({ orderRecordId: 'order-c', taxRate: null }),
      );
      productsService.getEffectiveTaxRate.mockResolvedValue(notChecked);

      const result = await service.classify(baseFilters, 'EUR');

      expect(result['tax-c']).toHaveLength(1);
      expect(result['tax-a']).toHaveLength(0);
      expect(result['tax-b']).toHaveLength(0);
    });

    it('prefers tax-b over tax-c when a pre-rollout order mixes a confirmed-no-rate line with a not-checked line', async () => {
      mockSinglePage([
        candidate({ internalOrderId: 'order-mixed', taxRateEra: 'pre-rollout' }),
      ]);
      setLines(
        makeLine({ id: 'line-1', lineNumber: 0, productId: 'p1', taxRate: null }),
        makeLine({ id: 'line-2', lineNumber: 1, productId: 'p2', taxRate: null }),
      );
      productsService.getEffectiveTaxRate
        .mockResolvedValueOnce(noRate)
        .mockResolvedValueOnce(notChecked);

      const result = await service.classify(baseFilters, 'EUR');

      expect(result['tax-b']).toHaveLength(1);
      expect(result['tax-c']).toHaveLength(0);
    });

    it('treats a catalogue read failure like not-checked rather than a confirmed no-rate', async () => {
      mockSinglePage([
        candidate({ internalOrderId: 'order-fail', taxRateEra: 'pre-rollout' }),
      ]);
      setLines(
        makeLine({ orderRecordId: 'order-fail', taxRate: null }),
      );
      productsService.getEffectiveTaxRate.mockRejectedValue(new Error('catalogue unavailable'));

      const result = await service.classify(baseFilters, 'EUR');

      expect(result['tax-c']).toHaveLength(1);
      expect(result['tax-b']).toHaveLength(0);
    });

    it('partitions a mixed candidate set with categories summing to the full candidate count (regression guard)', async () => {
      const candidates = [
        candidate({ internalOrderId: 'order-1', taxRateEra: null }),
        candidate({ internalOrderId: 'order-2', taxRateEra: 'pre-rollout' }),
        candidate({ internalOrderId: 'order-3', taxRateEra: 'pre-rollout' }),
      ];
      mockSinglePage(candidates);
      lineItemRepository.findByOrderIds.mockResolvedValue(
        linesMap(
          makeLine({ orderRecordId: 'order-2', productId: 'p-order-2', taxRate: '23' }),
          makeLine({ orderRecordId: 'order-3', productId: 'p-order-3', taxRate: null })
        )
      );
      productsService.getEffectiveTaxRate.mockResolvedValue(notChecked);

      const result = await service.classify(baseFilters, 'EUR');

      const total =
        result['tax-a'].length + result['tax-b'].length + result['tax-c'].length;
      expect(total).toBe(candidates.length);
      expect(result['tax-b']).toHaveLength(1);
      expect(result['tax-a']).toHaveLength(1);
      expect(result['tax-c']).toHaveLength(1);
    });

    it('resolves the catalogue rate ONCE per distinct (productId, variantId) pair, even when several orders/lines share it (#2826)', async () => {
      mockSinglePage([
        candidate({ internalOrderId: 'order-x', taxRateEra: 'pre-rollout' }),
        candidate({ internalOrderId: 'order-y', taxRateEra: 'pre-rollout' }),
      ]);
      lineItemRepository.findByOrderIds.mockResolvedValue(
        linesMap(
          makeLine({ id: 'line-x1', orderRecordId: 'order-x', productId: 'shared-product', taxRate: null }),
          makeLine({ id: 'line-x2', orderRecordId: 'order-x', lineNumber: 1, productId: 'shared-product', taxRate: null }),
          makeLine({ id: 'line-y1', orderRecordId: 'order-y', productId: 'shared-product', taxRate: null })
        )
      );
      productsService.getEffectiveTaxRate.mockResolvedValue(known('23'));

      const result = await service.classify(baseFilters, 'EUR');

      expect(productsService.getEffectiveTaxRate).toHaveBeenCalledTimes(1);
      expect(result['tax-a']).toHaveLength(2);
    });

    it('never runs more than the bounded concurrency ceiling of catalogue lookups in flight at once (#2826)', async () => {
      const KEY_COUNT = 12; // comfortably above RATE_LOOKUP_CONCURRENCY (5)
      mockSinglePage(
        Array.from({ length: KEY_COUNT }, (_, i) =>
          candidate({ internalOrderId: `order-${i}`, taxRateEra: 'pre-rollout' })
        )
      );
      lineItemRepository.findByOrderIds.mockResolvedValue(
        linesMap(
          ...Array.from({ length: KEY_COUNT }, (_, i) =>
            makeLine({
              id: `line-${i}`,
              orderRecordId: `order-${i}`,
              productId: `distinct-product-${i}`,
              taxRate: null,
            })
          )
        )
      );

      let inFlight = 0;
      let maxInFlight = 0;
      productsService.getEffectiveTaxRate.mockImplementation(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        // Yield so every worker gets a chance to start before any resolves —
        // otherwise a purely-synchronous mock would never let the bound show up.
        await new Promise((resolve) => setImmediate(resolve));
        inFlight -= 1;
        return known('23');
      });

      await service.classify(baseFilters, 'EUR');

      expect(productsService.getEffectiveTaxRate).toHaveBeenCalledTimes(KEY_COUNT);
      expect(maxInFlight).toBeLessThanOrEqual(5);
      expect(maxInFlight).toBeGreaterThan(1); // proves it actually ran concurrently, not sequentially
    });
  });

  describe('classify — bounded pagination (#2834)', () => {
    /**
     * Configure `findNetExcludedOrderCandidatesPage` to answer with `pages`
     * in order, one per successive call — the LAST page must carry
     * `nextCursor: null` or the mock under-specifies the loop's stop
     * condition and the test would hang against a real (non-mocked)
     * implementation.
     */
    const mockPages = (...pages: NetExcludedOrderCandidatePage[]): void => {
      for (const page of pages) {
        recordRepository.findNetExcludedOrderCandidatesPage.mockResolvedValueOnce(page);
      }
    };

    it('drives the repository across multiple pages and accumulates every page into one result', async () => {
      mockPages(
        {
          items: [
            candidate({ internalOrderId: 'order-page1-a', taxRateEra: null }),
            candidate({ internalOrderId: 'order-page1-b', taxRateEra: 'pre-rollout' }),
          ],
          nextCursor: { placedAt: new Date('2026-08-02T00:00:00Z'), internalOrderId: 'order-page1-b' },
        },
        {
          items: [candidate({ internalOrderId: 'order-page2-a', taxRateEra: null })],
          nextCursor: null,
        }
      );
      setLines(makeLine({ orderRecordId: 'order-page1-b', taxRate: '23' }));

      const result = await service.classify(baseFilters, 'EUR');

      expect(recordRepository.findNetExcludedOrderCandidatesPage).toHaveBeenCalledTimes(2);
      const total = result['tax-a'].length + result['tax-b'].length + result['tax-c'].length;
      expect(total).toBe(3);
      expect(result['tax-a'].map((row) => row.internalOrderId)).toEqual(['order-page1-b']);
      expect(result['tax-b'].map((row) => row.internalOrderId).sort()).toEqual([
        'order-page1-a',
        'order-page2-a',
      ]);
    });

    it('passes the previous page\'s nextCursor as the next call\'s cursor argument', async () => {
      const secondPageCursor = {
        placedAt: new Date('2026-08-03T00:00:00Z'),
        internalOrderId: 'order-page1-last',
      };
      mockPages(
        {
          items: [candidate({ internalOrderId: 'order-page1-last', taxRateEra: null })],
          nextCursor: secondPageCursor,
        },
        { items: [], nextCursor: null }
      );

      await service.classify(baseFilters, 'EUR');

      expect(recordRepository.findNetExcludedOrderCandidatesPage).toHaveBeenNthCalledWith(
        1,
        baseFilters,
        'EUR',
        false,
        null
      );
      expect(recordRepository.findNetExcludedOrderCandidatesPage).toHaveBeenNthCalledWith(
        2,
        baseFilters,
        'EUR',
        false,
        secondPageCursor
      );
    });

    it('stops as soon as a page reports nextCursor: null, without an extra trailing call', async () => {
      mockSinglePage([candidate({ internalOrderId: 'order-only', taxRateEra: null })]);

      await service.classify(baseFilters, 'EUR');

      expect(recordRepository.findNetExcludedOrderCandidatesPage).toHaveBeenCalledTimes(1);
    });

    it('stops immediately when the very first page is empty', async () => {
      mockSinglePage([]);

      const result = await service.classify(baseFilters, 'EUR');

      expect(recordRepository.findNetExcludedOrderCandidatesPage).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ 'tax-a': [], 'tax-b': [], 'tax-c': [] });
    });

    it('throws TaxCoveragePageCeilingExceededError rather than looping forever when the repository never reports a null nextCursor (defence-in-depth)', async () => {
      // A non-conforming port implementer (or a bug in a future one) whose
      // cursor fails to terminate must not hang the synchronous
      // `GET /analytics/coverage` request forever — it must fail loudly with
      // a named, finite-cost error instead (#2834 review).
      recordRepository.findNetExcludedOrderCandidatesPage.mockImplementation(() =>
        Promise.resolve({
          items: [candidate({ internalOrderId: 'order-never-terminates', taxRateEra: null })],
          nextCursor: { placedAt: new Date(), internalOrderId: 'order-never-terminates' },
        })
      );

      await expect(service.classify(baseFilters, 'EUR')).rejects.toThrow(
        TaxCoveragePageCeilingExceededError
      );
    });

    it('resolves the catalogue rate ONCE per distinct (productId, variantId) pair across MULTIPLE pages (#2826/#2834)', async () => {
      // The whole point of the dedup is that a pair referenced on one page and
      // again on a LATER page must still cost one catalogue read for the
      // entire `classify()` run — not once per page. This is the case the
      // single-page #2826 test (above) cannot exercise.
      mockPages(
        {
          items: [candidate({ internalOrderId: 'order-page1', taxRateEra: 'pre-rollout' })],
          nextCursor: { placedAt: new Date('2026-08-02T00:00:00Z'), internalOrderId: 'order-page1' },
        },
        {
          items: [candidate({ internalOrderId: 'order-page2', taxRateEra: 'pre-rollout' })],
          nextCursor: null,
        }
      );
      lineItemRepository.findByOrderIds.mockImplementation((ids: string[]) => {
        const map = new Map<string, ReturnType<typeof makeLine>[]>();
        if (ids.includes('order-page1')) {
          map.set('order-page1', [
            makeLine({ id: 'line-p1', orderRecordId: 'order-page1', productId: 'shared-product', taxRate: null }),
          ]);
        }
        if (ids.includes('order-page2')) {
          map.set('order-page2', [
            makeLine({ id: 'line-p2', orderRecordId: 'order-page2', productId: 'shared-product', taxRate: null }),
          ]);
        }
        return Promise.resolve(map);
      });
      productsService.getEffectiveTaxRate.mockResolvedValue(known('23'));

      const result = await service.classify(baseFilters, 'EUR');

      expect(productsService.getEffectiveTaxRate).toHaveBeenCalledTimes(1);
      expect(result['tax-a']).toHaveLength(2);
    });

    it('produces byte-identical output to a single-page population classifying the same candidates (batch-then-append equivalence)', async () => {
      const allCandidates = [
        candidate({ internalOrderId: 'order-1', taxRateEra: null }),
        candidate({ internalOrderId: 'order-2', taxRateEra: 'pre-rollout' }),
        candidate({ internalOrderId: 'order-3', taxRateEra: 'pre-rollout' }),
        candidate({ internalOrderId: 'order-4', taxRateEra: null }),
      ];
      const lines = linesMap(
        makeLine({ orderRecordId: 'order-2', productId: 'p-order-2', taxRate: '23' }),
        makeLine({ orderRecordId: 'order-3', productId: 'p-order-3', taxRate: null })
      );

      // Reference run: the whole population as ONE page (the pre-#2834 shape).
      recordRepository.findNetExcludedOrderCandidatesPage.mockReset();
      mockSinglePage(allCandidates);
      lineItemRepository.findByOrderIds.mockResolvedValue(lines);
      productsService.getEffectiveTaxRate.mockResolvedValue(notChecked);
      const singlePageResult = await service.classify(baseFilters, 'EUR');

      // Batched run: the SAME population split across three small pages.
      recordRepository.findNetExcludedOrderCandidatesPage.mockReset();
      mockPages(
        { items: [allCandidates[0]], nextCursor: { placedAt: new Date(), internalOrderId: 'a' } },
        { items: [allCandidates[1], allCandidates[2]], nextCursor: { placedAt: new Date(), internalOrderId: 'b' } },
        { items: [allCandidates[3]], nextCursor: null }
      );
      lineItemRepository.findByOrderIds.mockResolvedValue(lines);
      productsService.getEffectiveTaxRate.mockResolvedValue(notChecked);
      const multiPageResult = await service.classify(baseFilters, 'EUR');

      const sortByOrderId = (rows: typeof singlePageResult['tax-a']) =>
        [...rows].sort((a, b) => a.internalOrderId.localeCompare(b.internalOrderId));

      expect(sortByOrderId(multiPageResult['tax-a'])).toEqual(sortByOrderId(singlePageResult['tax-a']));
      expect(sortByOrderId(multiPageResult['tax-b'])).toEqual(sortByOrderId(singlePageResult['tax-b']));
      expect(sortByOrderId(multiPageResult['tax-c'])).toEqual(sortByOrderId(singlePageResult['tax-c']));
    });
  });

  describe('classify — per-line rate observations (#2798)', () => {
    it('threads the resolved rate for a multi-line, mixed-known/unknown pre-rollout order (regression guard for a single order-level rate)', async () => {
      mockSinglePage([
        candidate({ internalOrderId: 'order-mixed-rates', taxRateEra: 'pre-rollout' }),
      ]);
      setLines(
        makeLine({
          id: 'line-1',
          lineNumber: 0,
          orderRecordId: 'order-mixed-rates',
          productId: 'p1',
          taxRate: '23',
        }),
        makeLine({
          id: 'line-2',
          lineNumber: 1,
          orderRecordId: 'order-mixed-rates',
          productId: 'p2',
          variantId: 'v2',
          taxRate: null,
        }),
      );
      productsService.getEffectiveTaxRate.mockResolvedValue(known('8'));

      const result = await service.classify(baseFilters, 'EUR');

      expect(result['tax-a']).toHaveLength(1);
      expect(result['tax-a'][0].lineRates).toEqual([
        { productId: 'p1', variantId: null, rateCode: '23', state: 'known', unknownReason: null },
        { productId: 'p2', variantId: 'v2', rateCode: '8', state: 'known', unknownReason: null },
      ]);
      expect(productsService.getEffectiveTaxRate).toHaveBeenCalledWith('p2', 'v2');
    });

    it('reports a confirmed-no-rate line and a not-checked line each with their own state, never collapsed to one value', async () => {
      mockSinglePage([
        candidate({ internalOrderId: 'order-mixed-unresolved', taxRateEra: 'pre-rollout' }),
      ]);
      setLines(
        makeLine({ id: 'line-1', lineNumber: 0, productId: 'p1', taxRate: null }),
        makeLine({ id: 'line-2', lineNumber: 1, productId: 'p2', taxRate: null }),
      );
      productsService.getEffectiveTaxRate
        .mockResolvedValueOnce(noRate)
        .mockResolvedValueOnce(notChecked);

      const result = await service.classify(baseFilters, 'EUR');

      expect(result['tax-b']).toHaveLength(1);
      expect(result['tax-b'][0].lineRates).toEqual([
        { productId: 'p1', variantId: null, rateCode: null, state: 'no-rate', unknownReason: null },
        { productId: 'p2', variantId: null, rateCode: null, state: 'not-checked', unknownReason: null },
      ]);
    });

    it('carries the catalogue-reported reason (#2264) onto a no-rate observation, never onto a known or not-checked one', async () => {
      mockSinglePage([
        candidate({ internalOrderId: 'order-unknown-reason', taxRateEra: 'pre-rollout' }),
      ]);
      setLines(
        makeLine({ id: 'line-1', lineNumber: 0, productId: 'p1', taxRate: null }),
      );
      productsService.getEffectiveTaxRate.mockResolvedValue({
        code: null,
        countryIso2: 'PL',
        readAt: new Date('2026-08-24T00:00:00Z'),
        unknownReason: 'ambiguous',
      });

      const result = await service.classify(baseFilters, 'EUR');

      expect(result['tax-b'][0].lineRates).toEqual([
        {
          productId: 'p1',
          variantId: null,
          rateCode: null,
          state: 'no-rate',
          unknownReason: 'ambiguous',
        },
      ]);
    });

    it('does not touch line items or the catalogue for a non-pre-rollout candidate, reporting an empty lineRates array', async () => {
      mockSinglePage([
        candidate({ internalOrderId: 'order-post-rollout', taxRateEra: null }),
      ]);

      const result = await service.classify(baseFilters, 'EUR');

      expect(result['tax-b'][0].lineRates).toEqual([]);
      // Same contract as the `classify` guard above: no order ids requested,
      // and therefore no catalogue read either.
      expect(lineItemRepository.findByOrderIds).toHaveBeenCalledWith([]);
      expect(productsService.getEffectiveTaxRate).not.toHaveBeenCalled();
    });

    it('reports a catalogue read failure as a not-checked observation with no fabricated rate code', async () => {
      mockSinglePage([
        candidate({ internalOrderId: 'order-fail', taxRateEra: 'pre-rollout' }),
      ]);
      setLines(
        makeLine({ orderRecordId: 'order-fail', productId: 'p1', taxRate: null }),
      );
      productsService.getEffectiveTaxRate.mockRejectedValue(new Error('catalogue unavailable'));

      const result = await service.classify(baseFilters, 'EUR');

      expect(result['tax-c'][0].lineRates).toEqual([
        { productId: 'p1', variantId: null, rateCode: null, state: 'not-checked', unknownReason: null },
      ]);
    });

    it('normalizes rateCode the same way regardless of which of the two sources produced it (#2802 review)', async () => {
      mockSinglePage([
        candidate({ internalOrderId: 'order-normalize', taxRateEra: 'pre-rollout' }),
      ]);
      setLines(
        makeLine({ id: 'line-1', lineNumber: 0, productId: 'p1', taxRate: '23.00' }),
        makeLine({ id: 'line-2', lineNumber: 1, productId: 'p2', taxRate: null }),
      );
      productsService.getEffectiveTaxRate.mockResolvedValue(known('8.0'));

      const result = await service.classify(baseFilters, 'EUR');

      expect(result['tax-a'][0].lineRates).toEqual([
        { productId: 'p1', variantId: null, rateCode: '23', state: 'known', unknownReason: null },
        { productId: 'p2', variantId: null, rateCode: '8', state: 'known', unknownReason: null },
      ]);
    });
  });

  describe('getCategoryPage', () => {
    it('slices the classified result in-memory using the requested pagination', async () => {
      const candidates = Array.from({ length: 5 }, (_, i) =>
        candidate({ internalOrderId: `order-${i}`, taxRateEra: null })
      );
      mockSinglePage(candidates);

      const result = await service.getCategoryPage('tax-b', baseFilters, 'EUR', {
        limit: 2,
        offset: 2,
      });

      expect(result.total).toBe(5);
      expect(result.items).toHaveLength(2);
      expect(result.items[0].internalOrderId).toBe('order-2');
    });
  });

  describe('getCategoryCounts', () => {
    it('returns a count per category, including zero for an empty category', async () => {
      mockSinglePage([
        candidate({ internalOrderId: 'order-1', taxRateEra: null }),
      ]);

      const counts = await service.getCategoryCounts(baseFilters, 'EUR');

      expect(counts).toEqual({ 'tax-a': 0, 'tax-b': 1, 'tax-c': 0 });
    });
  });

  describe('getAllCategoryPages (#2466)', () => {
    it('returns all three categories from ONE classification pass', async () => {
      const candidates = [
        candidate({ internalOrderId: 'order-1', taxRateEra: null }),
        candidate({ internalOrderId: 'order-2', taxRateEra: 'pre-rollout' }),
      ];
      mockSinglePage(candidates);
      setLines(
        makeLine({ orderRecordId: 'order-2', taxRate: '23' }),
      );

      const pages = await service.getAllCategoryPages(baseFilters, 'EUR', {
        limit: 10,
        offset: 0,
      });

      expect(recordRepository.findNetExcludedOrderCandidatesPage).toHaveBeenCalledTimes(1);
      expect(pages['tax-a']).toEqual({
        items: [
          {
            internalOrderId: 'order-2',
            sourceConnectionId: 'conn-1',
            placedAt: expect.any(Date),
            lineRates: [
              {
                productId: 'ol_product_1',
                variantId: null,
                rateCode: '23',
                state: 'known',
                unknownReason: null,
              },
            ],
          },
        ],
        total: 1,
      });
      expect(pages['tax-b']).toEqual({
        items: [
          {
            internalOrderId: 'order-1',
            sourceConnectionId: 'conn-1',
            placedAt: expect.any(Date),
            lineRates: [],
          },
        ],
        total: 1,
      });
      expect(pages['tax-c']).toEqual({ items: [], total: 0 });
    });

    it('slices each category page in-memory by the requested pagination', async () => {
      const candidates = Array.from({ length: 5 }, (_, i) =>
        candidate({ internalOrderId: `order-${i}`, taxRateEra: null })
      );
      mockSinglePage(candidates);

      const pages = await service.getAllCategoryPages(baseFilters, 'EUR', {
        limit: 2,
        offset: 2,
      });

      expect(pages['tax-b'].total).toBe(5);
      expect(pages['tax-b'].items).toHaveLength(2);
      expect(pages['tax-b'].items[0].internalOrderId).toBe('order-2');
    });
  });

  describe('getAllCategoryCountsByConnection (#2713)', () => {
    it('groups all three categories by connection from ONE classification pass', async () => {
      const candidates = [
        candidate({ internalOrderId: 'order-1', sourceConnectionId: 'conn-a', taxRateEra: null }),
        candidate({ internalOrderId: 'order-2', sourceConnectionId: 'conn-a', taxRateEra: null }),
        candidate({ internalOrderId: 'order-3', sourceConnectionId: 'conn-b', taxRateEra: null }),
      ];
      mockSinglePage(candidates);

      const counts = await service.getAllCategoryCountsByConnection(baseFilters, 'EUR');

      expect(recordRepository.findNetExcludedOrderCandidatesPage).toHaveBeenCalledTimes(1);
      expect(counts['tax-b']).toEqual([
        { sourceConnectionId: 'conn-a', affectedCount: 2 },
        { sourceConnectionId: 'conn-b', affectedCount: 1 },
      ]);
      expect(counts['tax-a']).toEqual([]);
      expect(counts['tax-c']).toEqual([]);
    });

    it('sums to the same totals getCategoryCounts reports for the same filters', async () => {
      const candidates = [
        candidate({ internalOrderId: 'order-1', sourceConnectionId: 'conn-a', taxRateEra: null }),
        candidate({ internalOrderId: 'order-2', sourceConnectionId: 'conn-b', taxRateEra: null }),
        candidate({ internalOrderId: 'order-3', sourceConnectionId: 'conn-b', taxRateEra: null }),
      ];
      mockSinglePage(candidates);

      const counts = await service.getCategoryCounts(baseFilters, 'EUR');
      const byConnection = await service.getAllCategoryCountsByConnection(baseFilters, 'EUR');

      const totalFromByConnection = byConnection['tax-b'].reduce(
        (sum, row) => sum + row.affectedCount,
        0
      );
      expect(totalFromByConnection).toBe(counts['tax-b']);
    });

    it('never calls findNetExcludedOrderCandidatesPage more than once, regardless of category count', async () => {
      mockSinglePage([]);

      await service.getAllCategoryCountsByConnection(baseFilters, 'EUR');

      expect(recordRepository.findNetExcludedOrderCandidatesPage).toHaveBeenCalledTimes(1);
    });

    it('returns an empty array per category when nothing matches', async () => {
      mockSinglePage([]);

      const counts = await service.getAllCategoryCountsByConnection(baseFilters, 'EUR');

      expect(counts).toEqual({ 'tax-a': [], 'tax-b': [], 'tax-c': [] });
    });
  });
});
