/**
 * Price Change Apply Handler tests (#3144, ADR-072)
 *
 * @module apps/worker/src/sync/handlers/__tests__
 */
import { SyncJobExecutionError } from '@openlinker/core/sync';
import { CapabilityNotSupportedException } from '@openlinker/core/integrations';
import { PriceChangeEpisode } from '@openlinker/core/listings';
import { PriceChangeApplyHandler } from '../price-change-apply.handler';

interface FakeSyncJob {
  id: string;
  jobType: string;
  connectionId: string;
  payload: Record<string, unknown>;
}

function buildJob(payload: Record<string, unknown>): FakeSyncJob {
  return {
    id: 'job-1',
    jobType: 'pricing.propagateToMarketplaces',
    connectionId: 'dest-1',
    payload,
  };
}

function runHandler(
  handler: PriceChangeApplyHandler,
  payload: Record<string, unknown>
): ReturnType<PriceChangeApplyHandler['execute']> {
  return handler.execute(buildJob(payload) as never);
}

function buildEpisode(overrides: Partial<PriceChangeEpisode> = {}): PriceChangeEpisode {
  const base = {
    id: 'ep-1',
    productVariantId: 'ol_variant_1',
    destinationConnectionId: 'dest-1',
    sourceConnectionId: 'src-1',
    sourceCurrency: 'PLN',
    sourceOldAmount: 350,
    sourceNewAmount: 327,
    computedOldAmount: 427,
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
    base.resolution,
    base.resolvedByUserId,
    base.createdAt,
    base.updatedAt
  );
}

describe('PriceChangeApplyHandler', () => {
  let integrationsService: { getCapabilityAdapter: jest.Mock };
  let offerMappings: { findForVariant: jest.Mock };
  let inventoryQuery: { getAvailabilityByVariantIds: jest.Mock };
  let productPublishBuilder: { buildPublishProductCommand: jest.Mock };
  let episodes: { findById: jest.Mock; resolve: jest.Mock };
  let autoAppliedLog: { record: jest.Mock };
  let bulkProgress: { advanceBatchStatus: jest.Mock };
  let handler: PriceChangeApplyHandler;
  let marketplaceAdapter: { updateOfferFields: jest.Mock };

  beforeEach(() => {
    marketplaceAdapter = { updateOfferFields: jest.fn().mockResolvedValue(undefined) };
    integrationsService = {
      getCapabilityAdapter: jest.fn().mockResolvedValue(marketplaceAdapter),
    };
    offerMappings = {
      findForVariant: jest.fn().mockResolvedValue({ items: [{ externalId: 'ext-1' }], total: 1 }),
    };
    inventoryQuery = { getAvailabilityByVariantIds: jest.fn().mockResolvedValue([]) };
    productPublishBuilder = { buildPublishProductCommand: jest.fn() };
    episodes = {
      findById: jest.fn().mockResolvedValue(null),
      resolve: jest.fn().mockResolvedValue(true),
    };
    autoAppliedLog = { record: jest.fn().mockResolvedValue(undefined) };
    bulkProgress = { advanceBatchStatus: jest.fn().mockResolvedValue(null) };

    handler = new PriceChangeApplyHandler(
      integrationsService as never,
      offerMappings as never,
      inventoryQuery as never,
      productPublishBuilder as never,
      episodes as never,
      autoAppliedLog as never,
      bulkProgress as never
    );
  });

  it('publishes to a marketplace offer via updateOfferFields', async () => {
    const result = await runHandler(handler, {
      productVariantId: 'ol_variant_1',
      destinationConnectionId: 'dest-1',
      sourceConnectionId: 'src-1',
      amount: 399,
      currency: 'PLN',
      automatic: true,
    });

    expect(result).toEqual({ outcome: 'ok' });
    expect(marketplaceAdapter.updateOfferFields).toHaveBeenCalledWith(
      expect.objectContaining({
        externalOfferId: 'ext-1',
        fields: { price: { amount: '399.00', currency: 'PLN' } },
      })
    );
    expect(autoAppliedLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ productVariantId: 'ol_variant_1', newAmount: 399 })
    );
  });

  it('resolves the episode as accepted after a successful episode-based publish', async () => {
    episodes.findById.mockResolvedValue(buildEpisode());

    await runHandler(handler, {
      productVariantId: 'ol_variant_1',
      destinationConnectionId: 'dest-1',
      sourceConnectionId: 'src-1',
      amount: 399,
      currency: 'PLN',
      automatic: false,
      episodeId: 'ep-1',
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

  it('resolves as accepted-custom when manualPriceOverride is set', async () => {
    episodes.findById.mockResolvedValue(buildEpisode());

    await runHandler(handler, {
      productVariantId: 'ol_variant_1',
      destinationConnectionId: 'dest-1',
      sourceConnectionId: 'src-1',
      amount: 420,
      currency: 'PLN',
      automatic: false,
      episodeId: 'ep-1',
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

  it('returns a terminal business_failure for a blocked episode without publishing', async () => {
    episodes.findById.mockResolvedValue(buildEpisode({ blockReason: 'currency-mismatch' }));

    const result = await runHandler(handler, {
      productVariantId: 'ol_variant_1',
      destinationConnectionId: 'dest-1',
      sourceConnectionId: 'src-1',
      amount: 399,
      currency: 'PLN',
      automatic: false,
      episodeId: 'ep-1',
    });

    expect(result).toEqual({ outcome: 'business_failure' });
    expect(marketplaceAdapter.updateOfferFields).not.toHaveBeenCalled();
  });

  it('throws SyncJobExecutionError (letting the retry ladder handle it) on a transient marketplace failure', async () => {
    marketplaceAdapter.updateOfferFields.mockRejectedValue(new Error('rate limited'));

    await expect(
      runHandler(handler, {
        productVariantId: 'ol_variant_1',
        destinationConnectionId: 'dest-1',
        sourceConnectionId: 'src-1',
        amount: 399,
        currency: 'PLN',
        automatic: true,
      })
    ).rejects.toBeInstanceOf(SyncJobExecutionError);
  });

  it('falls back to the shop-product path when OfferManager is unsupported', async () => {
    integrationsService.getCapabilityAdapter.mockImplementation((_: string, capability: string) => {
      if (capability === 'OfferManager') {
        throw new CapabilityNotSupportedException('dest-1', 'OfferManager');
      }
      return Promise.resolve({ publishProduct: jest.fn().mockResolvedValue(undefined) });
    });
    inventoryQuery.getAvailabilityByVariantIds.mockResolvedValue([
      { productVariantId: 'ol_variant_1', totalAvailable: 12, locationCount: 1 },
    ]);
    productPublishBuilder.buildPublishProductCommand.mockResolvedValue({ id: 'cmd' });

    const result = await runHandler(handler, {
      productVariantId: 'ol_variant_1',
      destinationConnectionId: 'dest-1',
      sourceConnectionId: 'src-1',
      amount: 399,
      currency: 'PLN',
      automatic: true,
    });

    expect(result).toEqual({ outcome: 'ok' });
    expect(productPublishBuilder.buildPublishProductCommand).toHaveBeenCalledWith(
      expect.objectContaining({ stock: 12, status: 'published', price: { amount: 399, currency: 'PLN' } })
    );
  });

  it('advances bulk progress when a batchId is present', async () => {
    await runHandler(handler, {
      productVariantId: 'ol_variant_1',
      destinationConnectionId: 'dest-1',
      sourceConnectionId: 'src-1',
      amount: 399,
      currency: 'PLN',
      automatic: true,
      batchId: 'batch-1',
    });

    expect(bulkProgress.advanceBatchStatus).toHaveBeenCalledWith(
      'batch-1',
      expect.stringContaining('automatic:'),
      'succeeded'
    );
  });

  it('throws for a missing required payload field', async () => {
    await expect(runHandler(handler, {})).rejects.toBeInstanceOf(SyncJobExecutionError);
  });
});
