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
 * shared #1522 mapping fallback, abort handling, the per-input-item de-dup gate,
 * and the guaranteed terminal event on a mid-stream throw - plus the #2209
 * `assertStreamableConnection` gate step, which raises the same
 * connection-resolution errors without starting a stream or calling a
 * marketplace.
 *
 * The #2210 block additionally covers borrowed-matcher ISOLATION: a candidate
 * whose manifest declares no EAN matching is never built, an unrelated
 * connection that cannot be built (or a listing that throws outright) does not
 * break the destination's own resolve, a failed build of the only candidate
 * degrades to no-owner with `catalogueLookupPerformed: false`, and an
 * environment-qualified borrower matches only the owner of that environment.
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
  let integrationsService: { getCapabilityAdapter: jest.Mock; listCapabilityAdapters: jest.Mock };
  let mappingConfig: { resolveDestinationCategory: jest.Mock };
  let service: CategoryResolutionService;

  beforeEach(() => {
    integrationsService = {
      getCapabilityAdapter: jest.fn(),
      listCapabilityAdapters: jest.fn().mockResolvedValue([]),
    };
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
        { kind: 'done', resolvedCount: 1, unresolvedCount: 1, completion: 'complete', catalogueLookupPerformed: true },
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
        { kind: 'done', resolvedCount: 0, unresolvedCount: 2, completion: 'complete', catalogueLookupPerformed: true },
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
        { kind: 'done', resolvedCount: 1, unresolvedCount: 0, completion: 'complete', catalogueLookupPerformed: true },
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
        { kind: 'done', resolvedCount: 1, unresolvedCount: 1, completion: 'complete', catalogueLookupPerformed: true },
      ]);
    });

    it('should terminate immediately with no marketplace call when the adapter matches no EANs', async () => {
      // Epic #2205 decision 4 — a `borrows`-taxonomy destination (Erli, ADR-025
      // §3) is a first-class case: N no-match results, zero per-variant work.
      const adapter = { updateOfferQuantity: jest.fn() };
      integrationsService.getCapabilityAdapter.mockResolvedValue(adapter);
      // A mapping that WOULD resolve, on an item that carries source categories:
      // without both, the assertion below passes whether or not this path routes
      // through the #1522 fallback, and the parity claim goes unchecked.
      mappingConfig.resolveDestinationCategory.mockResolvedValue('cat-mapped');

      const events = await collect(
        service.resolveCategoriesStream(CONNECTION_ID, {
          items: [
            { variantId: 'v1', ean: '590111', sourceCategoryIds: ['src-1'] },
            { variantId: 'v2', ean: null },
          ],
        })
      );

      // Byte-identical to `resolveCategoriesBatch` for the same destination: it
      // returns `no-match` straight from the capability guard, before its own
      // fallback loop, so the streaming path must not resolve the mapping either.
      expect(events).toEqual([
        { kind: 'result', variantId: 'v1', result: { kind: 'no-match' } },
        { kind: 'result', variantId: 'v2', result: { kind: 'no-match' } },
        { kind: 'done', resolvedCount: 0, unresolvedCount: 2, completion: 'complete', catalogueLookupPerformed: false },
      ]);
      expect(adapter.updateOfferQuantity).not.toHaveBeenCalled();
      expect(mappingConfig.resolveDestinationCategory).not.toHaveBeenCalled();
    });

    it('should drop a duplicated variant and one the input never carried', async () => {
      const streamCategoriesForBatchByEan = streamingMatcher([
        { variantId: 'v1', result: { kind: 'no-match' } },
        // A retry wave inside the producer re-reports a variant it already sent.
        { variantId: 'v1', result: { kind: 'matched', allegroCategoryId: 'cat-1', productCardId: 'card-1' } },
        // And names one nobody asked about.
        { variantId: 'v9', result: { kind: 'matched', allegroCategoryId: 'cat-9', productCardId: 'card-9' } },
        { variantId: 'v2', result: { kind: 'no-ean' } },
      ]);
      integrationsService.getCapabilityAdapter.mockResolvedValue({
        updateOfferQuantity: jest.fn(),
        streamCategoriesForBatchByEan,
      });

      const events = await collect(service.resolveCategoriesStream(CONNECTION_ID, twoItems));

      // One `result` per INPUT item, so the tallies stay within the input size
      // and a progress bar keyed on it cannot run past 100%.
      expect(events).toEqual([
        { kind: 'result', variantId: 'v1', result: { kind: 'no-match' } },
        { kind: 'result', variantId: 'v2', result: { kind: 'no-ean' } },
        { kind: 'done', resolvedCount: 0, unresolvedCount: 2, completion: 'complete', catalogueLookupPerformed: true },
      ]);
    });

    it('should emit the terminal event and then rethrow when the adapter throws mid-stream', async () => {
      const boom = new Error('token refresh failed');
      const streamCategoriesForBatchByEan = jest.fn(() =>
        (async function* (): AsyncGenerator<EanCategoryMatchStreamItem> {
          await Promise.resolve();
          yield {
            variantId: 'v1',
            result: { kind: 'matched', allegroCategoryId: 'cat-1', productCardId: 'card-1' },
          };
          throw boom;
        })()
      );
      integrationsService.getCapabilityAdapter.mockResolvedValue({
        updateOfferQuantity: jest.fn(),
        streamCategoriesForBatchByEan,
      });

      const events: EanCategoryMatchStreamEvent[] = [];
      // A truncated stream must still be self-describing on the wire, and still
      // surface the underlying error to an in-process caller.
      await expect(
        (async (): Promise<void> => {
          for await (const event of service.resolveCategoriesStream(CONNECTION_ID, twoItems)) {
            events.push(event);
          }
        })()
      ).rejects.toBe(boom);

      expect(events).toEqual([
        {
          kind: 'result',
          variantId: 'v1',
          result: { kind: 'matched', allegroCategoryId: 'cat-1', productCardId: 'card-1' },
        },
        { kind: 'done', resolvedCount: 1, unresolvedCount: 0, completion: 'failed', catalogueLookupPerformed: true },
      ]);
    });

    it('should emit the terminal event when the shared mapping fallback throws', async () => {
      const boom = new Error('mapping lookup failed');
      const streamCategoriesForBatchByEan = streamingMatcher([
        { variantId: 'v1', result: { kind: 'matched', allegroCategoryId: 'cat-1', productCardId: 'card-1' } },
        { variantId: 'v2', result: { kind: 'no-match' } },
      ]);
      integrationsService.getCapabilityAdapter.mockResolvedValue({
        updateOfferQuantity: jest.fn(),
        streamCategoriesForBatchByEan,
      });
      // The fallback hits the DB, so it is a throw site the adapter's own
      // no-throw contract says nothing about.
      mappingConfig.resolveDestinationCategory.mockRejectedValue(boom);

      const events: EanCategoryMatchStreamEvent[] = [];
      await expect(
        (async (): Promise<void> => {
          for await (const event of service.resolveCategoriesStream(CONNECTION_ID, {
            items: [
              { variantId: 'v1', ean: '1' },
              { variantId: 'v2', ean: '2', sourceCategoryIds: ['src-1'] },
            ],
          })) {
            events.push(event);
          }
        })()
      ).rejects.toBe(boom);

      expect(events).toEqual([
        {
          kind: 'result',
          variantId: 'v1',
          result: { kind: 'matched', allegroCategoryId: 'cat-1', productCardId: 'card-1' },
        },
        { kind: 'done', resolvedCount: 1, unresolvedCount: 0, completion: 'failed', catalogueLookupPerformed: true },
      ]);
    });

    it('should schedule nothing at all when the signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      const events = await collect(
        service.resolveCategoriesStream(CONNECTION_ID, twoItems, { signal: controller.signal })
      );

      expect(events).toEqual([
        { kind: 'done', resolvedCount: 0, unresolvedCount: 0, completion: 'aborted', catalogueLookupPerformed: false },
      ]);
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
        { kind: 'done', resolvedCount: 0, unresolvedCount: 1, completion: 'aborted', catalogueLookupPerformed: true },
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
        { kind: 'done', resolvedCount: 0, unresolvedCount: 1, completion: 'aborted', catalogueLookupPerformed: true },
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

  describe('assertStreamableConnection', () => {
    it('should resolve the OfferManager adapter and nothing else', async () => {
      const streamCategoriesForBatchByEan = jest.fn();
      const resolveCategoriesForBatchByEan = jest.fn();
      integrationsService.getCapabilityAdapter.mockResolvedValue({
        updateOfferQuantity: jest.fn(),
        resolveCategoriesForBatchByEan,
        streamCategoriesForBatchByEan,
      });

      await expect(service.assertStreamableConnection(CONNECTION_ID)).resolves.toBeUndefined();

      expect(integrationsService.getCapabilityAdapter).toHaveBeenCalledWith(
        CONNECTION_ID,
        'OfferManager'
      );
      // The gate exists so a streaming transport can commit its status before it
      // spends marketplace quota, so it must not resolve a single category.
      expect(streamCategoriesForBatchByEan).not.toHaveBeenCalled();
      expect(resolveCategoriesForBatchByEan).not.toHaveBeenCalled();
      expect(mappingConfig.resolveDestinationCategory).not.toHaveBeenCalled();
    });

    it('should pass for a destination that declares no EAN capability at all', async () => {
      // Erli's case (ADR-025 §3): the stream terminates immediately with
      // no-match results, which is a valid run - not a gate rejection.
      integrationsService.getCapabilityAdapter.mockResolvedValue({
        updateOfferQuantity: jest.fn(),
      });

      await expect(service.assertStreamableConnection(CONNECTION_ID)).resolves.toBeUndefined();
    });

    it('should propagate the same connection-resolution error resolveCategoriesBatch raises', async () => {
      const boom = new Error('connection not found');
      integrationsService.getCapabilityAdapter.mockRejectedValue(boom);

      await expect(service.assertStreamableConnection(CONNECTION_ID)).rejects.toBe(boom);
    });
  });

  describe('borrowed-taxonomy EAN matching (#2210)', () => {
    const OWNER_ID = 'conn-allegro-1';

    /** A destination with no catalogue of its own, e.g. Erli (ADR-025 §3). */
    const borrowingDestination = {
      updateOfferQuantity: jest.fn(),
      getBorrowedTaxonomy: () => 'allegro' as const,
    };

    /** What a real `OfferManager` owner manifest declares (Allegro's). */
    const OWNER_METADATA = {
      supportedCapabilities: ['OfferManager', 'EanCategoryMatcher'],
    };

    const ownerEntry = (
      connectionId: string,
      createdAt: Date,
      matcher: jest.Mock,
      taxonomyIdentity: 'allegro' | 'allegro:sandbox' = 'allegro'
    ): Record<string, unknown> => ({
      connectionId,
      connection: { id: connectionId, createdAt },
      adapter: {
        updateOfferQuantity: jest.fn(),
        getTaxonomyIdentity: () => taxonomyIdentity,
        resolveCategoriesForBatchByEan: matcher,
      },
      metadata: OWNER_METADATA,
    });

    it('should resolve a borrowing destination by EAN through the owner connection', async () => {
      const matcher = jest.fn().mockResolvedValue(
        new Map([['v1', { kind: 'matched', allegroCategoryId: '9', productCardId: 'card-9' }]])
      );
      integrationsService.getCapabilityAdapter.mockResolvedValue(borrowingDestination);
      integrationsService.listCapabilityAdapters.mockResolvedValue([
        ownerEntry(OWNER_ID, new Date('2026-01-01'), matcher),
      ]);

      const result = await service.resolveCategoriesBatch(CONNECTION_ID, {
        items: [{ variantId: 'v1', ean: '5901234123457' }],
      });

      expect(matcher).toHaveBeenCalledTimes(1);
      expect(result.get('v1')).toEqual({
        kind: 'matched',
        allegroCategoryId: '9',
        productCardId: 'card-9',
      });
    });

    it('should leave the category to build-time mapping when no owner connection exists', async () => {
      integrationsService.getCapabilityAdapter.mockResolvedValue(borrowingDestination);
      integrationsService.listCapabilityAdapters.mockResolvedValue([]);

      const result = await service.resolveCategoriesBatch(CONNECTION_ID, {
        items: [{ variantId: 'v1', ean: '5901234123457' }],
      });

      // Unchanged pre-#2210 behaviour: nothing was asked, so nothing is claimed.
      expect(result.get('v1')).toEqual({ kind: 'no-match' });
      expect(mappingConfig.resolveDestinationCategory).not.toHaveBeenCalled();
    });

    it('should ignore an owner connection that cannot match EANs', async () => {
      integrationsService.getCapabilityAdapter.mockResolvedValue(borrowingDestination);
      integrationsService.listCapabilityAdapters.mockResolvedValue([
        {
          connectionId: OWNER_ID,
          connection: { id: OWNER_ID, createdAt: new Date('2026-01-01') },
          adapter: {
            updateOfferQuantity: jest.fn(),
            getTaxonomyIdentity: () => 'allegro' as const,
          },
          // Declared in the manifest, missing on the instance - the runtime
          // guard, not the manifest pre-filter, is what has to reject this.
          metadata: OWNER_METADATA,
        },
      ]);

      const result = await service.resolveCategoriesBatch(CONNECTION_ID, {
        items: [{ variantId: 'v1', ean: '5901234123457' }],
      });

      expect(result.get('v1')).toEqual({ kind: 'no-match' });
    });

    it('should pick the oldest owner deterministically when several qualify', async () => {
      const older = jest.fn().mockResolvedValue(
        new Map([['v1', { kind: 'matched', allegroCategoryId: 'older', productCardId: 'c' }]])
      );
      const newer = jest.fn().mockResolvedValue(new Map());
      integrationsService.getCapabilityAdapter.mockResolvedValue(borrowingDestination);
      integrationsService.listCapabilityAdapters.mockResolvedValue([
        ownerEntry('conn-newer', new Date('2026-06-01'), newer),
        ownerEntry('conn-older', new Date('2026-01-01'), older),
      ]);

      const result = await service.resolveCategoriesBatch(CONNECTION_ID, {
        items: [{ variantId: 'v1', ean: '5901234123457' }],
      });

      expect(older).toHaveBeenCalledTimes(1);
      expect(newer).not.toHaveBeenCalled();
      expect(result.get('v1')).toEqual({
        kind: 'matched',
        allegroCategoryId: 'older',
        productCardId: 'c',
      });
    });

    it('should borrow on the streaming path too and report the lookup as performed', async () => {
      const matcher = jest.fn().mockResolvedValue(
        new Map([['v1', { kind: 'matched', allegroCategoryId: '9', productCardId: 'card-9' }]])
      );
      integrationsService.getCapabilityAdapter.mockResolvedValue(borrowingDestination);
      integrationsService.listCapabilityAdapters.mockResolvedValue([
        ownerEntry(OWNER_ID, new Date('2026-01-01'), matcher),
      ]);

      const events = await collect(
        service.resolveCategoriesStream(CONNECTION_ID, {
          items: [{ variantId: 'v1', ean: '5901234123457' }],
        })
      );

      expect(matcher).toHaveBeenCalledTimes(1);
      expect(events).toEqual([
        {
          kind: 'result',
          variantId: 'v1',
          result: { kind: 'matched', allegroCategoryId: '9', productCardId: 'card-9' },
        },
        {
          kind: 'done',
          resolvedCount: 1,
          unresolvedCount: 0,
          completion: 'complete',
          catalogueLookupPerformed: true,
        },
      ]);
    });

    it('should report the lookup as NOT performed when nothing could be asked', async () => {
      integrationsService.getCapabilityAdapter.mockResolvedValue(borrowingDestination);
      integrationsService.listCapabilityAdapters.mockResolvedValue([]);

      const events = await collect(
        service.resolveCategoriesStream(CONNECTION_ID, {
          items: [{ variantId: 'v1', ean: '5901234123457' }],
        })
      );

      // The consumer needs this to tell "no category found" from "nothing was
      // looked up" - #1934/F10 is what conflating them costs.
      expect(events.at(-1)).toEqual({
        kind: 'done',
        resolvedCount: 0,
        unresolvedCount: 1,
        completion: 'complete',
        catalogueLookupPerformed: false,
      });
    });

    it('should skip a candidate whose manifest declares no EAN matching without building it', async () => {
      const built = jest.fn();
      integrationsService.getCapabilityAdapter.mockResolvedValue(borrowingDestination);
      integrationsService.listCapabilityAdapters.mockResolvedValue([
        {
          connectionId: 'conn-woocommerce',
          connection: { id: 'conn-woocommerce', createdAt: new Date('2025-01-01') },
          get adapter(): { updateOfferQuantity: jest.Mock } {
            built();
            return { updateOfferQuantity: jest.fn() };
          },
          metadata: { supportedCapabilities: ['OfferManager'] },
        },
      ]);

      const result = await service.resolveCategoriesBatch(CONNECTION_ID, {
        items: [{ variantId: 'v1', ean: '5901234123457' }],
      });

      expect(built).not.toHaveBeenCalled();
      expect(result.get('v1')).toEqual({ kind: 'no-match' });
    });

    it('should resolve normally when an unrelated connection cannot be built', async () => {
      const matcher = jest.fn().mockResolvedValue(
        new Map([['v1', { kind: 'matched', allegroCategoryId: '9', productCardId: 'card-9' }]])
      );
      integrationsService.getCapabilityAdapter.mockResolvedValue(borrowingDestination);
      integrationsService.listCapabilityAdapters.mockResolvedValue([
        {
          // Oldest, so it is attempted first - a half-configured but still
          // `active` connection must not take the destination's resolve down.
          connectionId: 'conn-broken',
          connection: { id: 'conn-broken', createdAt: new Date('2024-01-01') },
          get adapter(): Promise<never> {
            return Promise.reject(new Error('missing credentialsRef'));
          },
          metadata: OWNER_METADATA,
        },
        ownerEntry(OWNER_ID, new Date('2026-01-01'), matcher),
      ]);

      const result = await service.resolveCategoriesBatch(CONNECTION_ID, {
        items: [{ variantId: 'v1', ean: '5901234123457' }],
      });

      expect(matcher).toHaveBeenCalledTimes(1);
      expect(result.get('v1')).toEqual({
        kind: 'matched',
        allegroCategoryId: '9',
        productCardId: 'card-9',
      });
    });

    it('should degrade to no-owner when the only owner candidate fails to build', async () => {
      integrationsService.getCapabilityAdapter.mockResolvedValue(borrowingDestination);
      integrationsService.listCapabilityAdapters.mockResolvedValue([
        {
          connectionId: OWNER_ID,
          connection: { id: OWNER_ID, createdAt: new Date('2026-01-01') },
          get adapter(): Promise<never> {
            return Promise.reject(new Error('invalid Allegro config'));
          },
          metadata: OWNER_METADATA,
        },
      ]);

      const events = await collect(
        service.resolveCategoriesStream(CONNECTION_ID, {
          items: [{ variantId: 'v1', ean: '5901234123457' }],
        })
      );

      // Nothing was asked, so nothing may be claimed - and the stream completes
      // instead of failing, which is the whole point of the borrow being optional.
      expect(events.at(-1)).toEqual({
        kind: 'done',
        resolvedCount: 0,
        unresolvedCount: 1,
        completion: 'complete',
        catalogueLookupPerformed: false,
      });
    });

    it('should keep resolving when the owner listing itself throws', async () => {
      integrationsService.getCapabilityAdapter.mockResolvedValue(borrowingDestination);
      integrationsService.listCapabilityAdapters.mockRejectedValue(
        new Error('adapter key resolution failed for an unrelated connection')
      );

      const result = await service.resolveCategoriesBatch(CONNECTION_ID, {
        items: [{ variantId: 'v1', ean: '5901234123457' }],
      });

      expect(result.get('v1')).toEqual({ kind: 'no-match' });
    });

    it('should match a sandbox owner for a sandbox-borrowing destination', async () => {
      const sandboxDestination = {
        updateOfferQuantity: jest.fn(),
        getBorrowedTaxonomy: () => 'allegro:sandbox' as const,
      };
      const production = jest.fn().mockResolvedValue(new Map());
      const sandbox = jest.fn().mockResolvedValue(
        new Map([['v1', { kind: 'matched', allegroCategoryId: 'sbx', productCardId: 'card-sbx' }]])
      );
      integrationsService.getCapabilityAdapter.mockResolvedValue(sandboxDestination);
      integrationsService.listCapabilityAdapters.mockResolvedValue([
        ownerEntry('conn-allegro-prod', new Date('2025-01-01'), production, 'allegro'),
        ownerEntry('conn-allegro-sbx', new Date('2026-01-01'), sandbox, 'allegro:sandbox'),
      ]);

      const result = await service.resolveCategoriesBatch(CONNECTION_ID, {
        items: [{ variantId: 'v1', ean: '5901234123457' }],
      });

      // The production connection is older, so it is tried first and rejected on
      // identity - a sandbox borrower must never read the production tree (#2063).
      expect(production).not.toHaveBeenCalled();
      expect(sandbox).toHaveBeenCalledTimes(1);
      expect(result.get('v1')).toEqual({
        kind: 'matched',
        allegroCategoryId: 'sbx',
        productCardId: 'card-sbx',
      });
    });
  });
});
