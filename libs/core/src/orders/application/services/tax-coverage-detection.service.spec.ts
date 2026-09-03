import type { IProductsService } from '@openlinker/core/products';
import type { StoredTaxRate } from '@openlinker/core/products';

import { OrderLineItem } from '../../domain/entities/order-line-item.entity';
import type { OrderLineItemRepositoryPort } from '../../domain/ports/order-line-item-repository.port';
import type { OrderRecordRepositoryPort } from '../../domain/ports/order-record-repository.port';
import type { NetExcludedOrderCandidate } from '../../domain/types/coverage-detection.types';
import { TaxCoverageDetectionService } from './tax-coverage-detection.service';

describe('TaxCoverageDetectionService (#2465)', () => {
  let service: TaxCoverageDetectionService;
  let recordRepository: jest.Mocked<
    Pick<OrderRecordRepositoryPort, 'findNetExcludedOrderCandidates'>
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

  /** Groups lines by `orderRecordId` into the `Map` shape `findByOrderIds` returns. */
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
    recordRepository = { findNetExcludedOrderCandidates: jest.fn() };
    lineItemRepository = { findByOrderIds: jest.fn().mockResolvedValue(new Map()) };
    productsService = { getEffectiveTaxRate: jest.fn() };

    service = new TaxCoverageDetectionService(
      recordRepository as unknown as OrderRecordRepositoryPort,
      lineItemRepository as unknown as OrderLineItemRepositoryPort,
      productsService as unknown as IProductsService
    );
  });

  describe('classify', () => {
    it('reports tax-b for a non-pre-rollout candidate without touching line items or the catalogue', async () => {
      recordRepository.findNetExcludedOrderCandidates.mockResolvedValue([
        candidate({ internalOrderId: 'order-post-rollout', taxRateEra: null }),
      ]);

      const result = await service.classify(baseFilters, 'EUR');

      expect(result['tax-b']).toHaveLength(1);
      expect(result['tax-b'][0].internalOrderId).toBe('order-post-rollout');
      expect(result['tax-a']).toHaveLength(0);
      expect(result['tax-c']).toHaveLength(0);
      expect(lineItemRepository.findByOrderIds).toHaveBeenCalledWith([]);
    });

    it('reports tax-a when a pre-rollout order already has every line resolved (backfill already ran)', async () => {
      recordRepository.findNetExcludedOrderCandidates.mockResolvedValue([
        candidate({ internalOrderId: 'order-a', taxRateEra: 'pre-rollout' }),
      ]);
      lineItemRepository.findByOrderIds.mockResolvedValue(
        linesMap(makeLine({ orderRecordId: 'order-a', taxRate: '23' }))
      );

      const result = await service.classify(baseFilters, 'EUR');

      expect(result['tax-a']).toHaveLength(1);
      expect(result['tax-a'][0].internalOrderId).toBe('order-a');
      expect(productsService.getEffectiveTaxRate).not.toHaveBeenCalled();
    });

    it('reports tax-a when a pre-rollout order has an unresolved line that resolves live via the catalogue (the 31-row demo case)', async () => {
      recordRepository.findNetExcludedOrderCandidates.mockResolvedValue([
        candidate({ internalOrderId: 'order-a', taxRateEra: 'pre-rollout' }),
      ]);
      lineItemRepository.findByOrderIds.mockResolvedValue(
        linesMap(makeLine({ orderRecordId: 'order-a', productId: 'ol_product_x', taxRate: null }))
      );
      productsService.getEffectiveTaxRate.mockResolvedValue(known('23'));

      const result = await service.classify(baseFilters, 'EUR');

      expect(result['tax-a']).toHaveLength(1);
      expect(result['tax-b']).toHaveLength(0);
      expect(result['tax-c']).toHaveLength(0);
      expect(productsService.getEffectiveTaxRate).toHaveBeenCalledWith('ol_product_x', undefined);
    });

    it('reports tax-b when a pre-rollout order has an unresolved line the catalogue confirms carries no rate', async () => {
      recordRepository.findNetExcludedOrderCandidates.mockResolvedValue([
        candidate({ internalOrderId: 'order-b', taxRateEra: 'pre-rollout' }),
      ]);
      lineItemRepository.findByOrderIds.mockResolvedValue(
        linesMap(makeLine({ orderRecordId: 'order-b', taxRate: null }))
      );
      productsService.getEffectiveTaxRate.mockResolvedValue(noRate);

      const result = await service.classify(baseFilters, 'EUR');

      expect(result['tax-b']).toHaveLength(1);
      expect(result['tax-a']).toHaveLength(0);
      expect(result['tax-c']).toHaveLength(0);
    });

    it('reports tax-c when a pre-rollout order has an unresolved line the catalogue has never checked', async () => {
      recordRepository.findNetExcludedOrderCandidates.mockResolvedValue([
        candidate({ internalOrderId: 'order-c', taxRateEra: 'pre-rollout' }),
      ]);
      lineItemRepository.findByOrderIds.mockResolvedValue(
        linesMap(makeLine({ orderRecordId: 'order-c', taxRate: null }))
      );
      productsService.getEffectiveTaxRate.mockResolvedValue(notChecked);

      const result = await service.classify(baseFilters, 'EUR');

      expect(result['tax-c']).toHaveLength(1);
      expect(result['tax-a']).toHaveLength(0);
      expect(result['tax-b']).toHaveLength(0);
    });

    it('prefers tax-b over tax-c when a pre-rollout order mixes a confirmed-no-rate line with a not-checked line', async () => {
      recordRepository.findNetExcludedOrderCandidates.mockResolvedValue([
        candidate({ internalOrderId: 'order-mixed', taxRateEra: 'pre-rollout' }),
      ]);
      lineItemRepository.findByOrderIds.mockResolvedValue(
        linesMap(
          makeLine({
            id: 'line-1',
            orderRecordId: 'order-mixed',
            lineNumber: 0,
            productId: 'p1',
            taxRate: null,
          }),
          makeLine({
            id: 'line-2',
            orderRecordId: 'order-mixed',
            lineNumber: 1,
            productId: 'p2',
            taxRate: null,
          })
        )
      );
      productsService.getEffectiveTaxRate.mockImplementation((productId: string) =>
        Promise.resolve(productId === 'p1' ? noRate : notChecked)
      );

      const result = await service.classify(baseFilters, 'EUR');

      expect(result['tax-b']).toHaveLength(1);
      expect(result['tax-c']).toHaveLength(0);
    });

    it('treats a catalogue read failure like not-checked rather than a confirmed no-rate', async () => {
      recordRepository.findNetExcludedOrderCandidates.mockResolvedValue([
        candidate({ internalOrderId: 'order-fail', taxRateEra: 'pre-rollout' }),
      ]);
      lineItemRepository.findByOrderIds.mockResolvedValue(
        linesMap(makeLine({ orderRecordId: 'order-fail', taxRate: null }))
      );
      productsService.getEffectiveTaxRate.mockRejectedValue(new Error('catalogue unavailable'));

      const result = await service.classify(baseFilters, 'EUR');

      expect(result['tax-c']).toHaveLength(1);
      expect(result['tax-b']).toHaveLength(0);
    });

    it('resolves the catalogue rate ONCE per distinct (productId, variantId) pair, even when several orders/lines share it (#2826)', async () => {
      recordRepository.findNetExcludedOrderCandidates.mockResolvedValue([
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
      recordRepository.findNetExcludedOrderCandidates.mockResolvedValue(
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

    it('partitions a mixed candidate set with categories summing to the full candidate count (regression guard)', async () => {
      const candidates = [
        candidate({ internalOrderId: 'order-1', taxRateEra: null }),
        candidate({ internalOrderId: 'order-2', taxRateEra: 'pre-rollout' }),
        candidate({ internalOrderId: 'order-3', taxRateEra: 'pre-rollout' }),
      ];
      recordRepository.findNetExcludedOrderCandidates.mockResolvedValue(candidates);
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
  });

  describe('getCategoryPage', () => {
    it('slices the classified result in-memory using the requested pagination', async () => {
      const candidates = Array.from({ length: 5 }, (_, i) =>
        candidate({ internalOrderId: `order-${i}`, taxRateEra: null })
      );
      recordRepository.findNetExcludedOrderCandidates.mockResolvedValue(candidates);

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
      recordRepository.findNetExcludedOrderCandidates.mockResolvedValue([
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
      recordRepository.findNetExcludedOrderCandidates.mockResolvedValue(candidates);
      lineItemRepository.findByOrderIds.mockResolvedValue(
        linesMap(makeLine({ orderRecordId: 'order-2', taxRate: '23' }))
      );

      const pages = await service.getAllCategoryPages(baseFilters, 'EUR', {
        limit: 10,
        offset: 0,
      });

      expect(recordRepository.findNetExcludedOrderCandidates).toHaveBeenCalledTimes(1);
      expect(pages['tax-a']).toEqual({
        items: [
          { internalOrderId: 'order-2', sourceConnectionId: 'conn-1', placedAt: expect.any(Date) },
        ],
        total: 1,
      });
      expect(pages['tax-b']).toEqual({
        items: [
          { internalOrderId: 'order-1', sourceConnectionId: 'conn-1', placedAt: expect.any(Date) },
        ],
        total: 1,
      });
      expect(pages['tax-c']).toEqual({ items: [], total: 0 });
    });

    it('slices each category page in-memory by the requested pagination', async () => {
      const candidates = Array.from({ length: 5 }, (_, i) =>
        candidate({ internalOrderId: `order-${i}`, taxRateEra: null })
      );
      recordRepository.findNetExcludedOrderCandidates.mockResolvedValue(candidates);

      const pages = await service.getAllCategoryPages(baseFilters, 'EUR', {
        limit: 2,
        offset: 2,
      });

      expect(pages['tax-b'].total).toBe(5);
      expect(pages['tax-b'].items).toHaveLength(2);
      expect(pages['tax-b'].items[0].internalOrderId).toBe('order-2');
    });
  });
});
