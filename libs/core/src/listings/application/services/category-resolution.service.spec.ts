/**
 * Category Resolution Service — unit tests
 *
 * Covers the provenance-aware single-resolve chain (provision → barcode →
 * mapping → manual), provenance derivation from destination capabilities, and
 * the #795 batch path (`resolveCategoriesBatch`): delegation to the
 * `EanCategoryMatcher` sub-capability when supported, and graceful degradation
 * to `no-match` when the resolved adapter cannot batch-resolve EANs (a
 * `borrows`-taxonomy destination, e.g. Erli per ADR-025 §3).
 *
 * Also covers the #2207 streaming path (`resolveCategoriesStream`): pass-through
 * of an `EanCategoryMatcherStreaming` adapter, degradation to the batch
 * capability, the zero-call immediate stream for a destination with neither, the
 * shared #1522 mapping fallback, and abort handling.
 *
 * @module libs/core/src/listings/application/services
 */
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { IMappingConfigService } from '@openlinker/core/mappings';
import type {
  BatchCategoryByEanInput,
  EanCategoryMatchStreamEvent,
  EanCategoryMatchStreamItem,
  EanCategoryMatchStreamOptions,
  EanMatchResult,
} from '@openlinker/core/listings';

import { CategoryResolutionService } from './category-resolution.service';

const CONNECTION_ID = 'conn-123';

async function collect(
  stream: AsyncIterable<EanCategoryMatchStreamEvent>
): Promise<EanCategoryMatchStreamEvent[]> {
  const events: EanCategoryMatchStreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

describe('CategoryResolutionService', () => {
  let integrationsService: { getCapabilityAdapter: jest.Mock };
  let mappingConfig: { resolveDestinationCategory: jest.Mock };
  let service: CategoryResolutionService;

  beforeEach(() => {
    integrationsService = { getCapabilityAdapter: jest.fn() };
    mappingConfig = { resolveDestinationCategory: jest.fn() };
    service = new CategoryResolutionService(
      integrationsService as unknown as IIntegrationsService,
      mappingConfig as unknown as IMappingConfigService
    );
  });

  describe('resolveCategory', () => {
    it('should resolve via auto_detect when the adapter matches the barcode (borrows provenance)', async () => {
      // Adapter matches barcodes but ships no own category tree → borrows.
      integrationsService.getCapabilityAdapter.mockResolvedValue({
        updateOfferQuantity: jest.fn(),
        matchCategoryByBarcode: jest.fn().mockResolvedValue('allegro-cat-1'),
      });

      const result = await service.resolveCategory({ connectionId: CONNECTION_ID, barcode: '590' });

      expect(result).toEqual({
        destinationCategoryId: 'allegro-cat-1',
        provenance: 'borrows',
        method: 'auto_detect',
      });
    });

    it('should report owns provenance when the adapter browses its own category tree', async () => {
      integrationsService.getCapabilityAdapter.mockResolvedValue({
        updateOfferQuantity: jest.fn(),
        matchCategoryByBarcode: jest.fn().mockResolvedValue('allegro-cat-1'),
        fetchCategories: jest.fn(),
      });

      const result = await service.resolveCategory({ connectionId: CONNECTION_ID, barcode: '590' });

      expect(result).toEqual({
        destinationCategoryId: 'allegro-cat-1',
        provenance: 'owns',
        method: 'auto_detect',
      });
    });

    it('should report owns provenance when the adapter exposes per-category parameters', async () => {
      integrationsService.getCapabilityAdapter.mockResolvedValue({
        updateOfferQuantity: jest.fn(),
        matchCategoryByBarcode: jest.fn().mockResolvedValue('allegro-cat-1'),
        fetchCategoryParameters: jest.fn(),
      });

      const result = await service.resolveCategory({ connectionId: CONNECTION_ID, barcode: '590' });

      expect(result.provenance).toBe('owns');
    });

    it('should fall back to category_mapping when auto_detect misses (carrying barcode-path provenance)', async () => {
      integrationsService.getCapabilityAdapter.mockResolvedValue({
        updateOfferQuantity: jest.fn(),
        matchCategoryByBarcode: jest.fn().mockResolvedValue(null),
      });
      mappingConfig.resolveDestinationCategory.mockResolvedValue('allegro-cat-mapped');

      const result = await service.resolveCategory({
        connectionId: CONNECTION_ID,
        barcode: '590',
        sourceCategoryIds: ['src-1'],
      });

      expect(result).toEqual({
        destinationCategoryId: 'allegro-cat-mapped',
        provenance: 'borrows',
        method: 'category_mapping',
      });
    });

    it('should leave provenance null on the mapping path when no barcode is supplied', async () => {
      mappingConfig.resolveDestinationCategory.mockResolvedValue('allegro-cat-mapped');

      const result = await service.resolveCategory({
        connectionId: CONNECTION_ID,
        sourceCategoryIds: ['src-1'],
      });

      expect(result).toEqual({
        destinationCategoryId: 'allegro-cat-mapped',
        provenance: null,
        method: 'category_mapping',
      });
      // Laziness preserved — no adapter resolution without a barcode.
      expect(integrationsService.getCapabilityAdapter).not.toHaveBeenCalled();
    });

    it('should return manual with null id when nothing resolves', async () => {
      integrationsService.getCapabilityAdapter.mockResolvedValue({
        updateOfferQuantity: jest.fn(),
        matchCategoryByBarcode: jest.fn().mockResolvedValue(null),
      });

      const result = await service.resolveCategory({ connectionId: CONNECTION_ID, barcode: '590' });

      expect(result).toEqual({
        destinationCategoryId: null,
        provenance: 'borrows',
        method: 'manual',
      });
    });

    it('should treat the provision step as a no-op until CategoryProvisioner ships (#1041)', async () => {
      // Even a fully-capable adapter never yields method=provision today.
      integrationsService.getCapabilityAdapter.mockResolvedValue({
        updateOfferQuantity: jest.fn(),
        matchCategoryByBarcode: jest.fn().mockResolvedValue('allegro-cat-1'),
        fetchCategories: jest.fn(),
      });

      const result = await service.resolveCategory({ connectionId: CONNECTION_ID, barcode: '590' });

      expect(result.method).toBe('auto_detect');
      expect(result.method).not.toBe('provision');
    });
  });

  describe('resolveCategoriesBatch', () => {
    const input: BatchCategoryByEanInput = {
      items: [
        { variantId: 'v1', ean: '590111' },
        { variantId: 'v2', ean: null },
      ],
    };

    it('should delegate to the adapter when it implements EanCategoryMatcher', async () => {
      const adapterResult = new Map<string, EanMatchResult>([
        ['v1', { kind: 'matched', allegroCategoryId: 'cat-1', productCardId: 'card-1' }],
        ['v2', { kind: 'no-ean' }],
      ]);
      const resolveCategoriesForBatchByEan = jest.fn().mockResolvedValue(adapterResult);
      integrationsService.getCapabilityAdapter.mockResolvedValue({
        updateOfferQuantity: jest.fn(),
        resolveCategoriesForBatchByEan,
      });

      const result = await service.resolveCategoriesBatch(CONNECTION_ID, input);

      expect(integrationsService.getCapabilityAdapter).toHaveBeenCalledWith(
        CONNECTION_ID,
        'OfferManager'
      );
      // The adapter receives only the EAN-only shape (`sourceCategoryIds` is a
      // core-owned fallback input, never forwarded to the adapter).
      expect(resolveCategoriesForBatchByEan).toHaveBeenCalledWith({
        items: [
          { variantId: 'v1', ean: '590111' },
          { variantId: 'v2', ean: null },
        ],
      });
      // Returns one entry per input item, carrying the adapter's verdict when no
      // mapping fallback applies (no `sourceCategoryIds` on these items).
      expect(result.get('v1')).toEqual({
        kind: 'matched',
        allegroCategoryId: 'cat-1',
        productCardId: 'card-1',
      });
      expect(result.get('v2')).toEqual({ kind: 'no-ean' });
      expect(result.size).toBe(2);
    });

    it('should keep the EAN catalogue match when the EAN hits, ignoring the mapping', async () => {
      const resolveCategoriesForBatchByEan = jest.fn().mockResolvedValue(
        new Map<string, EanMatchResult>([
          ['v1', { kind: 'matched', allegroCategoryId: 'cat-ean', productCardId: 'card-1' }],
        ])
      );
      integrationsService.getCapabilityAdapter.mockResolvedValue({
        updateOfferQuantity: jest.fn(),
        resolveCategoriesForBatchByEan,
      });

      const result = await service.resolveCategoriesBatch(CONNECTION_ID, {
        items: [{ variantId: 'v1', ean: '590111', sourceCategoryIds: ['src-1'] }],
      });

      expect(result.get('v1')).toEqual({
        kind: 'matched',
        allegroCategoryId: 'cat-ean',
        productCardId: 'card-1',
      });
      // EAN won — the mapping was never consulted.
      expect(mappingConfig.resolveDestinationCategory).not.toHaveBeenCalled();
    });

    it('should fall back to category_mapping when the EAN misses but a source-category mapping exists', async () => {
      const resolveCategoriesForBatchByEan = jest.fn().mockResolvedValue(
        new Map<string, EanMatchResult>([['v1', { kind: 'no-match' }]])
      );
      integrationsService.getCapabilityAdapter.mockResolvedValue({
        updateOfferQuantity: jest.fn(),
        resolveCategoriesForBatchByEan,
      });
      mappingConfig.resolveDestinationCategory.mockResolvedValue('cat-mapped');

      const result = await service.resolveCategoriesBatch(CONNECTION_ID, {
        items: [{ variantId: 'v1', ean: '590111', sourceCategoryIds: ['src-deep', 'src-root'] }],
      });

      expect(result.get('v1')).toEqual({
        kind: 'matched',
        allegroCategoryId: 'cat-mapped',
        productCardId: '',
        method: 'category_mapping',
      });
      expect(mappingConfig.resolveDestinationCategory).toHaveBeenCalledWith(
        CONNECTION_ID,
        'src-deep'
      );
    });

    it('should fall back to category_mapping for a variant with no EAN but a mapped source category', async () => {
      const resolveCategoriesForBatchByEan = jest.fn().mockResolvedValue(
        new Map<string, EanMatchResult>([['v1', { kind: 'no-ean' }]])
      );
      integrationsService.getCapabilityAdapter.mockResolvedValue({
        updateOfferQuantity: jest.fn(),
        resolveCategoriesForBatchByEan,
      });
      mappingConfig.resolveDestinationCategory.mockResolvedValue('cat-mapped');

      const result = await service.resolveCategoriesBatch(CONNECTION_ID, {
        items: [{ variantId: 'v1', ean: null, sourceCategoryIds: ['src-1'] }],
      });

      expect(result.get('v1')).toEqual({
        kind: 'matched',
        allegroCategoryId: 'cat-mapped',
        productCardId: '',
        method: 'category_mapping',
      });
    });

    it('should stay no-match when the EAN misses and no source-category mapping resolves', async () => {
      const resolveCategoriesForBatchByEan = jest.fn().mockResolvedValue(
        new Map<string, EanMatchResult>([['v1', { kind: 'no-match' }]])
      );
      integrationsService.getCapabilityAdapter.mockResolvedValue({
        updateOfferQuantity: jest.fn(),
        resolveCategoriesForBatchByEan,
      });
      mappingConfig.resolveDestinationCategory.mockResolvedValue(null);

      const result = await service.resolveCategoriesBatch(CONNECTION_ID, {
        items: [{ variantId: 'v1', ean: '590111', sourceCategoryIds: ['src-1'] }],
      });

      expect(result.get('v1')).toEqual({ kind: 'no-match' });
      expect(mappingConfig.resolveDestinationCategory).toHaveBeenCalledWith(CONNECTION_ID, 'src-1');
    });

    it('should degrade to no-match for every variant when the adapter cannot batch-resolve', async () => {
      // An adapter that `borrows` its taxonomy (no EanCategoryMatcher, e.g. Erli
      // per ADR-025 §3) must not abort the batch — every variant degrades to
      // `no-match` so the operator can supply the category per row in Review.
      integrationsService.getCapabilityAdapter.mockResolvedValue({
        updateOfferQuantity: jest.fn(),
        // no resolveCategoriesForBatchByEan → not an EanCategoryMatcher
      });

      const result = await service.resolveCategoriesBatch(CONNECTION_ID, input);

      expect(result.get('v1')).toEqual({ kind: 'no-match' });
      expect(result.get('v2')).toEqual({ kind: 'no-match' });
      expect(result.size).toBe(2);
    });

    it('should propagate connection-resolution errors from getCapabilityAdapter', async () => {
      const boom = new Error('connection not found');
      integrationsService.getCapabilityAdapter.mockRejectedValue(boom);

      await expect(service.resolveCategoriesBatch(CONNECTION_ID, input)).rejects.toBe(boom);
    });
  });

  describe('resolveCategoriesStream', () => {
    const twoItems = {
      items: [
        { variantId: 'v1', ean: '590111' },
        { variantId: 'v2', ean: null },
      ],
    };

    /** Fake `EanCategoryMatcherStreaming` yielding the supplied outcomes in order. */
    function streamingMatcher(
      items: EanCategoryMatchStreamItem[],
      onYield?: (item: EanCategoryMatchStreamItem) => void
    ): jest.Mock {
      return jest.fn(
        (_input: BatchCategoryByEanInput, _options?: EanCategoryMatchStreamOptions) =>
          (async function* (): AsyncGenerator<EanCategoryMatchStreamItem> {
            for (const item of items) {
              // A real adapter awaits one marketplace call per item; keeping the
              // await here makes the abort test exercise a genuine suspension
              // point rather than a synchronous drain.
              await Promise.resolve();
              onYield?.(item);
              yield item;
            }
          })()
      );
    }

    it('should stream each variant as the adapter resolves it, then terminate once', async () => {
      const streamCategoriesForBatchByEan = streamingMatcher([
        {
          variantId: 'v1',
          result: { kind: 'matched', allegroCategoryId: 'cat-1', productCardId: 'card-1' },
        },
        { variantId: 'v2', result: { kind: 'no-ean' } },
      ]);
      const resolveCategoriesForBatchByEan = jest.fn();
      integrationsService.getCapabilityAdapter.mockResolvedValue({
        updateOfferQuantity: jest.fn(),
        streamCategoriesForBatchByEan,
        resolveCategoriesForBatchByEan,
      });

      const events = await collect(service.resolveCategoriesStream(CONNECTION_ID, twoItems));

      expect(integrationsService.getCapabilityAdapter).toHaveBeenCalledWith(
        CONNECTION_ID,
        'OfferManager'
      );
      expect(events).toEqual([
        {
          kind: 'result',
          variantId: 'v1',
          result: { kind: 'matched', allegroCategoryId: 'cat-1', productCardId: 'card-1' },
        },
        { kind: 'result', variantId: 'v2', result: { kind: 'no-ean' } },
        { kind: 'done', resolvedCount: 1, failedCount: 1 },
      ]);
      // The adapter receives only the EAN-only shape, and the streaming
      // capability wins over the batch one when both are declared.
      expect(streamCategoriesForBatchByEan).toHaveBeenCalledWith(
        { items: [{ variantId: 'v1', ean: '590111' }, { variantId: 'v2', ean: null }] },
        undefined
      );
      expect(resolveCategoriesForBatchByEan).not.toHaveBeenCalled();
    });

    it('should report an item the streaming adapter never yielded as unresolved', async () => {
      const streamCategoriesForBatchByEan = streamingMatcher([
        { variantId: 'v1', result: { kind: 'no-match' } },
      ]);
      integrationsService.getCapabilityAdapter.mockResolvedValue({
        updateOfferQuantity: jest.fn(),
        streamCategoriesForBatchByEan,
      });

      const events = await collect(service.resolveCategoriesStream(CONNECTION_ID, twoItems));

      expect(events).toEqual([
        { kind: 'result', variantId: 'v1', result: { kind: 'no-match' } },
        { kind: 'result', variantId: 'v2', result: { kind: 'no-match' } },
        { kind: 'done', resolvedCount: 0, failedCount: 2 },
      ]);
    });

    it('should apply the #1522 mapping fallback per item on the streaming path', async () => {
      const streamCategoriesForBatchByEan = streamingMatcher([
        { variantId: 'v1', result: { kind: 'no-match' } },
      ]);
      integrationsService.getCapabilityAdapter.mockResolvedValue({
        updateOfferQuantity: jest.fn(),
        streamCategoriesForBatchByEan,
      });
      mappingConfig.resolveDestinationCategory.mockResolvedValue('cat-mapped');

      const events = await collect(
        service.resolveCategoriesStream(CONNECTION_ID, {
          items: [{ variantId: 'v1', ean: '590111', sourceCategoryIds: ['src-deep', 'src-root'] }],
        })
      );

      expect(events).toEqual([
        {
          kind: 'result',
          variantId: 'v1',
          result: {
            kind: 'matched',
            allegroCategoryId: 'cat-mapped',
            productCardId: '',
            method: 'category_mapping',
          },
        },
        { kind: 'done', resolvedCount: 1, failedCount: 0 },
      ]);
      expect(mappingConfig.resolveDestinationCategory).toHaveBeenCalledWith(
        CONNECTION_ID,
        'src-deep'
      );
    });

    it('should fall back to the batch capability when the adapter cannot stream', async () => {
      const resolveCategoriesForBatchByEan = jest.fn().mockResolvedValue(
        new Map<string, EanMatchResult>([
          ['v1', { kind: 'matched', allegroCategoryId: 'cat-1', productCardId: 'card-1' }],
          ['v2', { kind: 'no-ean' }],
        ])
      );
      integrationsService.getCapabilityAdapter.mockResolvedValue({
        updateOfferQuantity: jest.fn(),
        resolveCategoriesForBatchByEan,
      });

      const events = await collect(service.resolveCategoriesStream(CONNECTION_ID, twoItems));

      expect(resolveCategoriesForBatchByEan).toHaveBeenCalledWith({
        items: [{ variantId: 'v1', ean: '590111' }, { variantId: 'v2', ean: null }],
      });
      expect(events).toEqual([
        {
          kind: 'result',
          variantId: 'v1',
          result: { kind: 'matched', allegroCategoryId: 'cat-1', productCardId: 'card-1' },
        },
        { kind: 'result', variantId: 'v2', result: { kind: 'no-ean' } },
        { kind: 'done', resolvedCount: 1, failedCount: 1 },
      ]);
    });

    it('should terminate immediately with no marketplace call when the adapter matches no EANs', async () => {
      // Epic #2205 decision 4 — a `borrows`-taxonomy destination (Erli, ADR-025
      // §3) is a first-class case: N no-match results, zero per-variant work.
      const adapter = { updateOfferQuantity: jest.fn() };
      integrationsService.getCapabilityAdapter.mockResolvedValue(adapter);

      const events = await collect(service.resolveCategoriesStream(CONNECTION_ID, twoItems));

      expect(events).toEqual([
        { kind: 'result', variantId: 'v1', result: { kind: 'no-match' } },
        { kind: 'result', variantId: 'v2', result: { kind: 'no-match' } },
        { kind: 'done', resolvedCount: 0, failedCount: 2 },
      ]);
      expect(adapter.updateOfferQuantity).not.toHaveBeenCalled();
      expect(mappingConfig.resolveDestinationCategory).not.toHaveBeenCalled();
    });

    it('should schedule nothing at all when the signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      const events = await collect(
        service.resolveCategoriesStream(CONNECTION_ID, twoItems, { signal: controller.signal })
      );

      expect(events).toEqual([{ kind: 'done', resolvedCount: 0, failedCount: 0 }]);
      // Resolving the adapter can decrypt credentials and mint a token — work
      // the caller already told us to stop scheduling.
      expect(integrationsService.getCapabilityAdapter).not.toHaveBeenCalled();
    });

    it('should stop consuming the streaming adapter once the signal aborts', async () => {
      const controller = new AbortController();
      const yielded: string[] = [];
      const streamCategoriesForBatchByEan = streamingMatcher(
        [
          { variantId: 'v1', result: { kind: 'no-match' } },
          { variantId: 'v2', result: { kind: 'no-match' } },
          { variantId: 'v3', result: { kind: 'no-match' } },
        ],
        (item) => yielded.push(item.variantId)
      );
      integrationsService.getCapabilityAdapter.mockResolvedValue({
        updateOfferQuantity: jest.fn(),
        streamCategoriesForBatchByEan,
      });

      const events: EanCategoryMatchStreamEvent[] = [];
      for await (const event of service.resolveCategoriesStream(
        CONNECTION_ID,
        {
          items: [
            { variantId: 'v1', ean: '1' },
            { variantId: 'v2', ean: '2' },
            { variantId: 'v3', ean: '3' },
          ],
        },
        { signal: controller.signal }
      )) {
        events.push(event);
        if (event.kind === 'result') {
          controller.abort();
        }
      }

      // The signal is forwarded so the adapter can stop its own scheduling, and
      // the abort ends the stream with the tally earned so far — never with the
      // remaining variants fabricated as unresolved.
      expect(streamCategoriesForBatchByEan).toHaveBeenCalledWith(expect.anything(), {
        signal: controller.signal,
      });
      expect(events).toEqual([
        { kind: 'result', variantId: 'v1', result: { kind: 'no-match' } },
        { kind: 'done', resolvedCount: 0, failedCount: 1 },
      ]);
      expect(yielded).not.toContain('v3');
    });

    it('should stop scheduling mapping lookups on the batch path once the signal aborts', async () => {
      const controller = new AbortController();
      integrationsService.getCapabilityAdapter.mockResolvedValue({
        updateOfferQuantity: jest.fn(),
        resolveCategoriesForBatchByEan: jest.fn().mockResolvedValue(
          new Map<string, EanMatchResult>([
            ['v1', { kind: 'no-match' }],
            ['v2', { kind: 'no-match' }],
          ])
        ),
      });
      mappingConfig.resolveDestinationCategory.mockResolvedValue(null);

      const events: EanCategoryMatchStreamEvent[] = [];
      for await (const event of service.resolveCategoriesStream(
        CONNECTION_ID,
        {
          items: [
            { variantId: 'v1', ean: '1', sourceCategoryIds: ['src-1'] },
            { variantId: 'v2', ean: '2', sourceCategoryIds: ['src-2'] },
          ],
        },
        { signal: controller.signal }
      )) {
        events.push(event);
        if (event.kind === 'result') {
          controller.abort();
        }
      }

      expect(events).toEqual([
        { kind: 'result', variantId: 'v1', result: { kind: 'no-match' } },
        { kind: 'done', resolvedCount: 0, failedCount: 1 },
      ]);
      expect(mappingConfig.resolveDestinationCategory).toHaveBeenCalledTimes(1);
    });

    it('should surface connection-resolution errors on the first iteration', async () => {
      const boom = new Error('connection not found');
      integrationsService.getCapabilityAdapter.mockRejectedValue(boom);

      await expect(collect(service.resolveCategoriesStream(CONNECTION_ID, twoItems))).rejects.toBe(
        boom
      );
    });
  });
});
