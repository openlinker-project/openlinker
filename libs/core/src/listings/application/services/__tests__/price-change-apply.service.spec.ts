/**
 * Price Change Apply Service tests (#3144, ADR-072, #3161 review)
 *
 * @module libs/core/src/listings/application/services/__tests__
 */
import { Connection } from '@openlinker/core/identifier-mapping';
import { PriceChangeApplyService } from '../price-change-apply.service';
import { PriceChangeEpisode } from '../../../domain/entities/price-change-episode.entity';
import { ListingCreationRecord } from '../../../domain/entities/listing-creation-record.entity';
import { AvailabilityUnknownError } from '../../../domain/exceptions/availability-unknown.error';
import type { PriceChangeApplyInput } from '../../../domain/types/price-change-apply.types';

function buildConnection(overrides: Partial<Connection> = {}): Connection {
  const base = {
    id: 'dest-1',
    platformType: 'allegro',
    name: 'Allegro',
    status: 'active' as const,
    config: {},
    credentialsRef: 'ref',
    createdAt: new Date(),
    updatedAt: new Date(),
    adapterKey: undefined,
    enabledCapabilities: ['OfferManager'],
    ...overrides,
  };
  return new Connection(
    base.id,
    base.platformType,
    base.name,
    base.status,
    base.config,
    base.credentialsRef,
    base.createdAt,
    base.updatedAt,
    base.adapterKey,
    base.enabledCapabilities
  );
}

function buildEpisode(overrides: Partial<Record<string, unknown>> = {}): PriceChangeEpisode {
  const base = {
    id: 'ep-1',
    productVariantId: 'ol_variant_1',
    destinationConnectionId: 'dest-1',
    sourceConnectionId: 'src-1',
    sourceCurrency: 'PLN',
    sourceOldAmount: 350,
    sourceNewAmount: 327,
    computedOldAmount: 427 as number | null,
    computedNewAmount: 399,
    manualPriceOverride: null,
    manualPriceOverrideSetAt: null,
    blockReason: null as string | null,
    detectedAt: new Date(),
    refreshedAt: null,
    resolvedAt: null,
    resolution: null,
    resolvedByUserId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  return new PriceChangeEpisode(
    base.id,
    base.productVariantId,
    base.destinationConnectionId,
    base.sourceConnectionId,
    base.sourceCurrency,
    base.sourceOldAmount,
    base.sourceNewAmount,
    base.computedOldAmount,
    base.computedNewAmount,
    base.manualPriceOverride,
    base.manualPriceOverrideSetAt,
    base.blockReason as never,
    base.detectedAt,
    base.refreshedAt,
    base.resolvedAt,
    base.resolution as never,
    base.resolvedByUserId,
    base.createdAt,
    base.updatedAt
  );
}

describe('PriceChangeApplyService', () => {
  let connections: { get: jest.Mock };
  let integrationsService: { resolveAdapterMetadata: jest.Mock; getCapabilityAdapter: jest.Mock };
  let offerMappings: { findForVariant: jest.Mock };
  let inventoryQuery: { getAvailabilityByVariantIds: jest.Mock };
  let productPublishExecution: { executePublish: jest.Mock };
  let episodes: { findById: jest.Mock; resolve: jest.Mock };
  let autoAppliedLog: { record: jest.Mock };
  let bulkProgress: { advanceBatchStatus: jest.Mock };
  let listingRecords: { findLatestByVariantAndConnection: jest.Mock };
  let identifierMapping: { getExternalIds: jest.Mock };
  let syncLock: { acquire: jest.Mock; release: jest.Mock };
  let syncCursors: { getCursor: jest.Mock; advanceCursorIfNewer: jest.Mock };
  let marketplaceAdapter: { updateOfferFields: jest.Mock };
  let service: PriceChangeApplyService;

  const validInput: PriceChangeApplyInput = {
    productVariantId: 'ol_variant_1',
    destinationConnectionId: 'dest-1',
    sourceConnectionId: 'src-1',
    amount: 399,
    currency: 'PLN',
    automatic: true,
  };

  beforeEach(() => {
    connections = { get: jest.fn().mockResolvedValue(buildConnection()) };
    marketplaceAdapter = { updateOfferFields: jest.fn().mockResolvedValue(undefined) };
    integrationsService = {
      resolveAdapterMetadata: jest.fn().mockResolvedValue({
        adapterKey: 'allegro.publicapi.v1',
        platformType: 'allegro',
        supportedCapabilities: ['OfferManager'],
      }),
      getCapabilityAdapter: jest.fn().mockResolvedValue(marketplaceAdapter),
    };
    offerMappings = {
      findForVariant: jest.fn().mockResolvedValue({ items: [{ externalId: 'ext-1' }], total: 1 }),
    };
    inventoryQuery = { getAvailabilityByVariantIds: jest.fn().mockResolvedValue([]) };
    productPublishExecution = { executePublish: jest.fn() };
    episodes = {
      findById: jest.fn().mockResolvedValue(null),
      resolve: jest.fn().mockResolvedValue(true),
    };
    autoAppliedLog = { record: jest.fn().mockResolvedValue(undefined) };
    bulkProgress = { advanceBatchStatus: jest.fn().mockResolvedValue(null) };
    listingRecords = { findLatestByVariantAndConnection: jest.fn().mockResolvedValue(null) };
    // Default: no prior `ShopProduct` mapping resolvable, so the shop-publish
    // guard (#3161 re-review, IMPORTANT) takes the unguarded fallback and
    // every pre-existing shop-publish test below is unaffected.
    identifierMapping = { getExternalIds: jest.fn().mockResolvedValue([]) };
    syncLock = {
      acquire: jest.fn().mockResolvedValue('lock-token'),
      release: jest.fn().mockResolvedValue(true),
    };
    syncCursors = {
      getCursor: jest.fn().mockResolvedValue(null),
      advanceCursorIfNewer: jest.fn().mockResolvedValue(true),
    };

    service = new PriceChangeApplyService(
      connections as never,
      integrationsService as never,
      offerMappings as never,
      inventoryQuery as never,
      productPublishExecution as never,
      episodes as never,
      autoAppliedLog as never,
      bulkProgress as never,
      listingRecords as never,
      identifierMapping as never,
      syncLock as never,
      syncCursors as never
    );
  });

  describe('capability branch selection (#3161 review, BLOCKING)', () => {
    it('publishes to a marketplace when OfferManager is supported and enabled', async () => {
      const result = await service.applyPriceChange(validInput);

      expect(result).toEqual({ outcome: 'ok' });
      expect(marketplaceAdapter.updateOfferFields).toHaveBeenCalledWith(
        expect.objectContaining({
          externalOfferId: 'ext-1',
          fields: { price: { amount: '399.00', currency: 'PLN' } },
        })
      );
    });

    it('never decides the branch by catching an exception — a disabled OfferManager falls through to a business_failure rather than being silently read as "this is a shop"', async () => {
      // WooCommerce shape: OfferManager is in the manifest but the operator
      // has not enabled it, AND ProductPublisher is not enabled either.
      connections.get.mockResolvedValue(
        buildConnection({ enabledCapabilities: [] })
      );
      integrationsService.resolveAdapterMetadata.mockResolvedValue({
        adapterKey: 'woocommerce.restapi.v3',
        platformType: 'woocommerce',
        supportedCapabilities: ['OfferManager', 'ProductPublisher'],
      });

      const result = await service.applyPriceChange(validInput);

      expect(result.outcome).toBe('business_failure');
      expect(integrationsService.getCapabilityAdapter).not.toHaveBeenCalled();
      expect(marketplaceAdapter.updateOfferFields).not.toHaveBeenCalled();
    });

    it('resolves to the shop branch only when ProductPublisher is actually enabled, not merely because OfferManager is absent', async () => {
      connections.get.mockResolvedValue(
        buildConnection({ enabledCapabilities: ['ProductPublisher'] })
      );
      integrationsService.resolveAdapterMetadata.mockResolvedValue({
        adapterKey: 'woocommerce.restapi.v3',
        platformType: 'woocommerce',
        supportedCapabilities: ['OfferManager', 'ProductPublisher'],
      });
      inventoryQuery.getAvailabilityByVariantIds.mockResolvedValue([
        { productVariantId: 'ol_variant_1', totalAvailable: 12, locationCount: 1, availableToPromise: 9 },
      ]);
      productPublishExecution.executePublish.mockResolvedValue({
        outcome: 'ok',
        listingCreationRecord: new ListingCreationRecord(
          'rec-1',
          'ol_variant_1',
          'dest-1',
          'ext-shop-1',
          'published',
          null,
          new Date(),
          new Date()
        ),
      });

      const result = await service.applyPriceChange(validInput);

      expect(result).toEqual({ outcome: 'ok' });
      expect(integrationsService.getCapabilityAdapter).not.toHaveBeenCalled();
      expect(productPublishExecution.executePublish).toHaveBeenCalledWith(
        expect.objectContaining({ stock: 9, status: 'published', price: { amount: 399, currency: 'PLN' } })
      );
    });

    it('returns business_failure when OfferManager is enabled but the adapter does not implement OfferFieldUpdater', async () => {
      integrationsService.getCapabilityAdapter.mockResolvedValue({
        // no updateOfferFields — e.g. WooCommerceOfferManagerAdapter, which
        // implements only updateOfferQuantity.
      });

      const result = await service.applyPriceChange(validInput);

      expect(result.outcome).toBe('business_failure');
    });

    it('returns business_failure when neither capability is enabled', async () => {
      connections.get.mockResolvedValue(buildConnection({ enabledCapabilities: [] }));

      const result = await service.applyPriceChange(validInput);

      expect(result.outcome).toBe('business_failure');
    });
  });

  describe('marketplace publish', () => {
    it('returns business_failure when no offer mapping exists for the variant', async () => {
      offerMappings.findForVariant.mockResolvedValue({ items: [], total: 0 });

      const result = await service.applyPriceChange(validInput);

      expect(result.outcome).toBe('business_failure');
      expect(marketplaceAdapter.updateOfferFields).not.toHaveBeenCalled();
    });

    it('treats a seller-frozen price field as business_failure, not success (#3161 review, IMPORTANT)', async () => {
      marketplaceAdapter.updateOfferFields.mockResolvedValue({
        frozenFields: [{ field: 'price', currentValue: '350.00' }],
      });

      const result = await service.applyPriceChange(validInput);

      expect(result.outcome).toBe('business_failure');
      expect(autoAppliedLog.record).not.toHaveBeenCalled();
      expect(episodes.resolve).not.toHaveBeenCalled();
    });

    it('throws (transient, retryable) on a marketplace API failure, preserving the error', async () => {
      const cause = new Error('rate limited');
      marketplaceAdapter.updateOfferFields.mockRejectedValue(cause);

      await expect(service.applyPriceChange(validInput)).rejects.toBe(cause);
    });

    it('does NOT fail the whole episode when only SOME mapped offers are seller-frozen (#3161 re-review, IMPORTANT — a partial write is not a total failure)', async () => {
      offerMappings.findForVariant.mockResolvedValue({
        items: [{ externalId: 'ext-1' }, { externalId: 'ext-2' }],
        total: 2,
      });
      marketplaceAdapter.updateOfferFields.mockImplementation(
        ({ externalOfferId }: { externalOfferId: string }) =>
          Promise.resolve(
            externalOfferId === 'ext-2'
              ? { frozenFields: [{ field: 'price', currentValue: '350.00' }] }
              : undefined
          )
      );

      const result = await service.applyPriceChange(validInput);

      expect(result).toEqual({ outcome: 'ok' });
      expect(marketplaceAdapter.updateOfferFields).toHaveBeenCalledTimes(2);
      // The successful offer's price change is still recorded as applied —
      // the whole point of the fix — via the ordinary success path.
      expect(episodes.resolve).not.toHaveBeenCalled(); // no episodeId on this input
    });

    it('still returns business_failure when EVERY mapped offer is seller-frozen', async () => {
      offerMappings.findForVariant.mockResolvedValue({
        items: [{ externalId: 'ext-1' }, { externalId: 'ext-2' }],
        total: 2,
      });
      marketplaceAdapter.updateOfferFields.mockResolvedValue({
        frozenFields: [{ field: 'price', currentValue: '350.00' }],
      });

      const result = await service.applyPriceChange(validInput);

      expect(result.outcome).toBe('business_failure');
    });

    it('rounds the price to the currency\'s own minor-unit exponent rather than hardcoding two decimals (#3161 re-review, IMPORTANT)', async () => {
      await service.applyPriceChange({ ...validInput, amount: 500, currency: 'JPY' });

      expect(marketplaceAdapter.updateOfferFields).toHaveBeenCalledWith(
        expect.objectContaining({ fields: { price: { amount: '500', currency: 'JPY' } } })
      );
    });

    it('derives the adapter idempotency key from the episode id, never from wall-clock time (#3161 re-review, SUGGESTION)', async () => {
      episodes.findById.mockResolvedValue(buildEpisode({ id: 'ep-42' }));

      await service.applyPriceChange({ ...validInput, episodeId: 'ep-42' });

      expect(marketplaceAdapter.updateOfferFields).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotencyKey: expect.stringContaining('episode:ep-42'),
        })
      );
      const [[call]] = marketplaceAdapter.updateOfferFields.mock.calls as [
        { idempotencyKey: string },
      ][];
      expect(call.idempotencyKey).not.toMatch(/\d{4}-\d{2}-\d{2}T/); // no ISO timestamp
    });
  });

  describe('shop publish', () => {
    beforeEach(() => {
      connections.get.mockResolvedValue(buildConnection({ enabledCapabilities: ['ProductPublisher'] }));
      integrationsService.resolveAdapterMetadata.mockResolvedValue({
        adapterKey: 'woocommerce.restapi.v3',
        platformType: 'woocommerce',
        supportedCapabilities: ['ProductPublisher'],
      });
    });

    it('throws AvailabilityUnknownError (transient) rather than defaulting stock to 0 when ATP is null (#3161 review, BLOCKING)', async () => {
      inventoryQuery.getAvailabilityByVariantIds.mockResolvedValue([
        { productVariantId: 'ol_variant_1', totalAvailable: 5, locationCount: 1, availableToPromise: null },
      ]);

      await expect(service.applyPriceChange(validInput)).rejects.toBeInstanceOf(
        AvailabilityUnknownError
      );
      expect(productPublishExecution.executePublish).not.toHaveBeenCalled();
    });

    it('throws AvailabilityUnknownError when the variant has no availability row at all', async () => {
      inventoryQuery.getAvailabilityByVariantIds.mockResolvedValue([]);

      await expect(service.applyPriceChange(validInput)).rejects.toBeInstanceOf(
        AvailabilityUnknownError
      );
    });

    it('reuses the previous publish snapshot for category/content/parameters/commerce rather than re-deriving them on a price-only change (#3161 review, BLOCKING)', async () => {
      inventoryQuery.getAvailabilityByVariantIds.mockResolvedValue([
        { productVariantId: 'ol_variant_1', totalAvailable: 12, locationCount: 1, availableToPromise: 9 },
      ]);
      listingRecords.findLatestByVariantAndConnection.mockResolvedValue(
        new ListingCreationRecord(
          'rec-0',
          'ol_variant_1',
          'dest-1',
          'ext-shop-1',
          'published',
          null,
          new Date(),
          new Date(),
          null,
          null,
          {
            internalVariantId: 'ol_variant_1',
            status: 'published',
            stock: 12,
            destinationCategoryIds: ['cat-9'],
            content: { title: 'Existing title' },
          }
        )
      );
      productPublishExecution.executePublish.mockResolvedValue({
        outcome: 'ok',
        listingCreationRecord: new ListingCreationRecord(
          'rec-1',
          'ol_variant_1',
          'dest-1',
          'ext-shop-1',
          'published',
          null,
          new Date(),
          new Date()
        ),
      });

      await service.applyPriceChange(validInput);

      expect(productPublishExecution.executePublish).toHaveBeenCalledWith(
        expect.objectContaining({
          destinationCategoryIds: ['cat-9'],
          content: { title: 'Existing title' },
        })
      );
    });

    it('surfaces a business_failure result from executePublish as this service\'s own business_failure', async () => {
      inventoryQuery.getAvailabilityByVariantIds.mockResolvedValue([
        { productVariantId: 'ol_variant_1', totalAvailable: 12, locationCount: 1, availableToPromise: 9 },
      ]);
      productPublishExecution.executePublish.mockResolvedValue({
        outcome: 'business_failure',
        listingCreationRecord: new ListingCreationRecord(
          'rec-1',
          'ol_variant_1',
          'dest-1',
          null,
          'failed',
          [{ code: 'REJECTED', message: 'shop rejected the price' }],
          new Date(),
          new Date()
        ),
      });

      const result = await service.applyPriceChange(validInput);

      expect(result.outcome).toBe('business_failure');
    });

    describe('ADR-067/#2617 stock write-order guard (#3161 re-review, IMPORTANT)', () => {
      beforeEach(() => {
        inventoryQuery.getAvailabilityByVariantIds.mockResolvedValue([
          {
            productVariantId: 'ol_variant_1',
            totalAvailable: 12,
            locationCount: 1,
            availableToPromise: 9,
            stockUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
          },
        ]);
        identifierMapping.getExternalIds.mockResolvedValue([
          { externalId: 'ext-shop-1', platformType: 'woocommerce', connectionId: 'dest-1', entityType: 'ShopProduct' },
        ]);
        productPublishExecution.executePublish.mockResolvedValue({
          outcome: 'ok',
          listingCreationRecord: new ListingCreationRecord(
            'rec-1',
            'ol_variant_1',
            'dest-1',
            'ext-shop-1',
            'published',
            null,
            new Date(),
            new Date()
          ),
        });
      });

      it('takes the same per-(connection, offer) lock InventorySyncService uses, keyed by the ShopProduct external id, and releases it after a successful write', async () => {
        await service.applyPriceChange(validInput);

        expect(syncLock.acquire).toHaveBeenCalledWith(
          expect.stringContaining('ext-shop-1'),
          expect.any(Number)
        );
        expect(syncLock.release).toHaveBeenCalledWith(
          expect.stringContaining('ext-shop-1'),
          'lock-token'
        );
      });

      it('advances the shared observation cursor after a successful write, so a slower/earlier InventorySyncService write-back correctly refuses to overwrite it with a stale quantity', async () => {
        await service.applyPriceChange(validInput);

        expect(syncCursors.advanceCursorIfNewer).toHaveBeenCalledWith(
          'dest-1',
          expect.stringContaining('ext-shop-1'),
          '2026-01-01T00:00:00.000Z'
        );
      });

      it('releases the lock even when the publish rejects, and never advances the cursor on a rejection', async () => {
        productPublishExecution.executePublish.mockResolvedValue({
          outcome: 'business_failure',
          listingCreationRecord: new ListingCreationRecord(
            'rec-1',
            'ol_variant_1',
            'dest-1',
            null,
            'failed',
            [{ code: 'REJECTED', message: 'shop rejected the price' }],
            new Date(),
            new Date()
          ),
        });

        const result = await service.applyPriceChange(validInput);

        expect(result.outcome).toBe('business_failure');
        expect(syncLock.release).toHaveBeenCalled();
        expect(syncCursors.advanceCursorIfNewer).not.toHaveBeenCalled();
      });

      it('throws a retryable ContendedWriteError rather than proceeding unguarded when a peer holds the lock', async () => {
        syncLock.acquire.mockResolvedValue(null);

        await expect(service.applyPriceChange(validInput)).rejects.toMatchObject({
          name: 'ContendedWriteError',
        });
        expect(productPublishExecution.executePublish).not.toHaveBeenCalled();
      });

      it('publishes unguarded (no lock taken) when no prior ShopProduct mapping is resolvable', async () => {
        identifierMapping.getExternalIds.mockResolvedValue([]);

        const result = await service.applyPriceChange(validInput);

        expect(result).toEqual({ outcome: 'ok' });
        expect(syncLock.acquire).not.toHaveBeenCalled();
      });
    });
  });

  describe('episode resolution vs the auto-applied log (#3161 review, BLOCKING — every prior write recorded oldAmount === newAmount)', () => {
    it('resolves the episode AND writes the auto-applied log for an automatic apply, using the episode\'s real computedOldAmount', async () => {
      episodes.findById.mockResolvedValue(buildEpisode({ computedOldAmount: 427 }));

      await service.applyPriceChange({ ...validInput, episodeId: 'ep-1', automatic: true });

      expect(episodes.resolve).toHaveBeenCalledWith('ep-1', 'accepted', null, null, expect.any(Date));
      expect(autoAppliedLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ oldAmount: 427, newAmount: 399 })
      );
    });

    it('resolves the episode but does NOT write the auto-applied log for a non-automatic (review-queue) accept', async () => {
      episodes.findById.mockResolvedValue(buildEpisode({ computedOldAmount: 427 }));

      await service.applyPriceChange({
        ...validInput,
        episodeId: 'ep-1',
        automatic: false,
        resolvedByUserId: 'user-1',
      });

      expect(episodes.resolve).toHaveBeenCalledWith(
        'ep-1',
        'accepted',
        'user-1',
        null,
        expect.any(Date)
      );
      expect(autoAppliedLog.record).not.toHaveBeenCalled();
    });

    it('resolves as accepted-custom and pins the override amount when manualPriceOverride is set', async () => {
      episodes.findById.mockResolvedValue(buildEpisode());

      await service.applyPriceChange({
        ...validInput,
        episodeId: 'ep-1',
        automatic: false,
        amount: 420,
        manualPriceOverride: true,
      });

      expect(episodes.resolve).toHaveBeenCalledWith(
        'ep-1',
        'accepted-custom',
        null,
        420,
        expect.any(Date)
      );
    });

    it('logs oldAmount as null rather than fabricating it as newAmount when the episode has no baseline', async () => {
      episodes.findById.mockResolvedValue(buildEpisode({ computedOldAmount: null }));

      await service.applyPriceChange({ ...validInput, episodeId: 'ep-1', automatic: true });

      expect(autoAppliedLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ oldAmount: null, newAmount: 399 })
      );
    });

    it('returns business_failure without publishing when the episode is not found', async () => {
      episodes.findById.mockResolvedValue(null);

      const result = await service.applyPriceChange({ ...validInput, episodeId: 'missing' });

      expect(result.outcome).toBe('business_failure');
      expect(marketplaceAdapter.updateOfferFields).not.toHaveBeenCalled();
    });

    it('returns business_failure without publishing when the episode carries a blockReason', async () => {
      episodes.findById.mockResolvedValue(buildEpisode({ blockReason: 'currency-mismatch' }));

      const result = await service.applyPriceChange({ ...validInput, episodeId: 'ep-1' });

      expect(result.outcome).toBe('business_failure');
      expect(marketplaceAdapter.updateOfferFields).not.toHaveBeenCalled();
    });

    it('does not fail the apply when resolve() reports a lost race (already resolved concurrently)', async () => {
      episodes.findById.mockResolvedValue(buildEpisode());
      episodes.resolve.mockResolvedValue(false);

      const result = await service.applyPriceChange({ ...validInput, episodeId: 'ep-1' });

      expect(result.outcome).toBe('ok');
    });
  });

  describe('bulk progress advancement', () => {
    it('advances succeeded when a batchId is present', async () => {
      await service.applyPriceChange({ ...validInput, batchId: 'batch-1' });

      expect(bulkProgress.advanceBatchStatus).toHaveBeenCalledWith(
        'batch-1',
        expect.stringContaining('automatic:'),
        'succeeded'
      );
    });

    it('advances failed on every business_failure exit, not just the blockReason branch', async () => {
      offerMappings.findForVariant.mockResolvedValue({ items: [], total: 0 });

      await service.applyPriceChange({ ...validInput, batchId: 'batch-1' });

      expect(bulkProgress.advanceBatchStatus).toHaveBeenCalledWith(
        'batch-1',
        expect.any(String),
        'failed'
      );
    });

    it('uses the episodeId as the childId when present', async () => {
      episodes.findById.mockResolvedValue(buildEpisode());

      await service.applyPriceChange({
        ...validInput,
        episodeId: 'ep-1',
        batchId: 'batch-1',
      });

      expect(bulkProgress.advanceBatchStatus).toHaveBeenCalledWith('batch-1', 'ep-1', 'succeeded');
    });
  });
});
