/**
 * Price Change Detection Service tests (#3143, ADR-072)
 *
 * @module libs/core/src/listings/application/services/__tests__
 */
import { Connection } from '@openlinker/core/identifier-mapping';
import type { ConnectionPort, IIdentifierMappingService } from '@openlinker/core/identifier-mapping';
import type { JobEnqueuePort } from '@openlinker/core/sync';
import { PriceChangeDetectionService } from '../price-change-detection.service';
import { PriceChangeEpisode } from '../../../domain/entities/price-change-episode.entity';
import type { PriceChangeEpisodeRepositoryPort } from '../../../domain/ports/price-change-episode-repository.port';

const VARIANT_ID = 'ol_variant_1';
const DEST_ID = 'dest-conn-1';
const SRC_ID = 'src-conn-1';

function buildConnection(config: Record<string, unknown> = {}, status = 'active'): Connection {
  return new Connection(
    DEST_ID,
    'allegro',
    'Allegro — PL',
    status as Connection['status'],
    config,
    'ref',
    new Date(),
    new Date(),
    undefined,
    []
  );
}

function buildEpisode(overrides: Partial<PriceChangeEpisode> = {}): PriceChangeEpisode {
  const base = {
    id: 'ep-1',
    productVariantId: VARIANT_ID,
    destinationConnectionId: DEST_ID,
    sourceConnectionId: SRC_ID,
    sourceCurrency: 'PLN',
    sourceOldAmount: 350,
    sourceNewAmount: 327,
    computedOldAmount: 427,
    computedNewAmount: 399,
    manualPriceOverride: null,
    manualPriceOverrideSetAt: null,
    blockReason: null,
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
    base.blockReason,
    base.detectedAt,
    base.refreshedAt,
    base.resolvedAt,
    base.resolution,
    base.resolvedByUserId,
    base.createdAt,
    base.updatedAt
  );
}

describe('PriceChangeDetectionService', () => {
  let identifierMapping: jest.Mocked<IIdentifierMappingService>;
  let connections: jest.Mocked<ConnectionPort>;
  let episodes: jest.Mocked<PriceChangeEpisodeRepositoryPort>;
  let jobEnqueue: jest.Mocked<JobEnqueuePort>;
  let service: PriceChangeDetectionService;

  beforeEach(() => {
    identifierMapping = {
      getExternalIds: jest.fn(),
    } as unknown as jest.Mocked<IIdentifierMappingService>;
    connections = {
      get: jest.fn(),
    } as unknown as jest.Mocked<ConnectionPort>;
    episodes = {
      findOpenByKey: jest.fn(),
      findLastResolvedByKey: jest.fn(),
      upsertOpen: jest.fn(),
    } as unknown as jest.Mocked<PriceChangeEpisodeRepositoryPort>;
    jobEnqueue = {
      enqueueJob: jest.fn(),
    } as unknown as jest.Mocked<JobEnqueuePort>;

    service = new PriceChangeDetectionService(identifierMapping, connections, episodes, jobEnqueue);

    identifierMapping.getExternalIds.mockImplementation((entityType) =>
      Promise.resolve(
        entityType === 'Offer'
          ? [{ connectionId: DEST_ID, externalId: 'x', platformType: 'allegro', entityType }]
          : []
      )
    );
    connections.get.mockResolvedValue(buildConnection());
    episodes.findOpenByKey.mockResolvedValue(null);
    episodes.findLastResolvedByKey.mockResolvedValue(null);
  });

  it('does nothing when the source price has not actually changed', async () => {
    await service.onMasterPriceChanged({
      productVariantId: VARIANT_ID,
      sourceConnectionId: SRC_ID,
      sourceOldAmount: 350,
      sourceNewAmount: 350,
      sourceCurrency: 'PLN',
    });

    expect(identifierMapping.getExternalIds).not.toHaveBeenCalled();
  });

  it('opens an episode for a manual-mode destination on a real price change', async () => {
    await service.onMasterPriceChanged({
      productVariantId: VARIANT_ID,
      sourceConnectionId: SRC_ID,
      sourceOldAmount: 350,
      sourceNewAmount: 327,
      sourceCurrency: 'PLN',
    });

    expect(episodes.upsertOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        productVariantId: VARIANT_ID,
        destinationConnectionId: DEST_ID,
        sourceConnectionId: SRC_ID,
        sourceNewAmount: 327,
        blockReason: null,
      })
    );
    expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
  });

  it('sets blockReason: currency-mismatch and does not enqueue automatically, even if the pair is automatic', async () => {
    connections.get.mockResolvedValue(
      buildConnection({
        currency: 'EUR',
        priceSyncMode: { default: 'automatic', sourceOverrides: {} },
      })
    );

    await service.onMasterPriceChanged({
      productVariantId: VARIANT_ID,
      sourceConnectionId: SRC_ID,
      sourceOldAmount: 350,
      sourceNewAmount: 327,
      sourceCurrency: 'PLN',
    });

    expect(episodes.upsertOpen).toHaveBeenCalledWith(
      expect.objectContaining({ blockReason: 'currency-mismatch' })
    );
    expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
  });

  it('bypasses the review queue and enqueues directly for an automatic-mode destination', async () => {
    connections.get.mockResolvedValue(
      buildConnection({ priceSyncMode: { default: 'automatic', sourceOverrides: {} } })
    );

    await service.onMasterPriceChanged({
      productVariantId: VARIANT_ID,
      sourceConnectionId: SRC_ID,
      sourceOldAmount: 350,
      sourceNewAmount: 327,
      sourceCurrency: 'PLN',
    });

    expect(episodes.upsertOpen).not.toHaveBeenCalled();
    expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobType: 'pricing.propagateToMarketplaces',
        connectionId: DEST_ID,
        payload: expect.objectContaining({
          productVariantId: VARIANT_ID,
          destinationConnectionId: DEST_ID,
          sourceConnectionId: SRC_ID,
          automatic: true,
        }),
      })
    );
  });

  it('refreshes the SAME open episode on re-detection rather than skipping it', async () => {
    episodes.findOpenByKey.mockResolvedValue(buildEpisode());

    await service.onMasterPriceChanged({
      productVariantId: VARIANT_ID,
      sourceConnectionId: SRC_ID,
      sourceOldAmount: 327,
      sourceNewAmount: 310,
      sourceCurrency: 'PLN',
    });

    expect(episodes.upsertOpen).toHaveBeenCalledWith(
      expect.objectContaining({ sourceNewAmount: 310, computedOldAmount: 427 })
    );
  });

  it('skips a destination with an unknown/inactive connection', async () => {
    connections.get.mockRejectedValue(new Error('not found'));

    await service.onMasterPriceChanged({
      productVariantId: VARIANT_ID,
      sourceConnectionId: SRC_ID,
      sourceOldAmount: 350,
      sourceNewAmount: 327,
      sourceCurrency: 'PLN',
    });

    expect(episodes.upsertOpen).not.toHaveBeenCalled();
    expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
  });

  it('does nothing when the rule-computed price is unchanged from the last resolved episode', async () => {
    episodes.findLastResolvedByKey.mockResolvedValue(
      buildEpisode({ resolvedAt: new Date(), resolution: 'accepted', computedNewAmount: 350 })
    );

    await service.onMasterPriceChanged({
      productVariantId: VARIANT_ID,
      sourceConnectionId: SRC_ID,
      sourceOldAmount: 327,
      sourceNewAmount: 350, // passthrough rule (default connection config) => computed == 350
      sourceCurrency: 'PLN',
    });

    expect(episodes.upsertOpen).not.toHaveBeenCalled();
  });
});
