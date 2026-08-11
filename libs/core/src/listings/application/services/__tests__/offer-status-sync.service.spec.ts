/**
 * Offer Status Sync Service Tests
 *
 * Covers the steady-state offer-status refresh (#816): per-offer upsert,
 * transition detection, no-capability skip, marketplace-not-found handling,
 * offset advancement + wrap-around, and transient-error propagation.
 *
 * @module libs/core/src/listings/application/services/__tests__
 */
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type {
  OfferManagerPort,
  OfferStatusReadResult,
  OfferMappingRepositoryPort,
  OfferStatusSnapshotRepositoryPort,
  OfferCommercialSnapshotRepositoryPort,
  OfferMappingListItem,
  PaginatedOfferMappings,
  UpsertOfferStatusSnapshotCommand,
} from '@openlinker/core/listings';
import { IdentifierMapping } from '@openlinker/core/identifier-mapping';
import { OfferNotFoundOnMarketplaceException } from '@openlinker/core/listings';

import { OfferCommercialSnapshot } from '../../../domain/entities/offer-commercial-snapshot.entity';
import { OfferStatusSnapshot } from '../../../domain/entities/offer-status-snapshot.entity';
import type { OfferPublicationStatus } from '../../../domain/types/offer-status-read.types';
import { OfferStatusSyncService } from '../offer-status-sync.service';

const CONNECTION_ID = 'conn-allegro-1';

function commercialSnapshot(): OfferCommercialSnapshot {
  const now = new Date('2026-08-11T00:00:00.000Z');
  return new OfferCommercialSnapshot({
    id: 'ocs-1',
    connectionId: CONNECTION_ID,
    externalOfferId: '111',
    internalVariantId: 'ol_variant_a',
    price: '99.99',
    currency: 'PLN',
    availableQuantity: 12,
    lastCommercialSyncedAt: now,
    createdAt: now,
    updatedAt: now,
  });
}

function makeMapping(externalOfferId: string, internalVariantId: string): OfferMappingListItem {
  const mapping = new IdentifierMapping(
    `idmap-${externalOfferId}`,
    'Offer',
    internalVariantId,
    externalOfferId,
    'allegro',
    CONNECTION_ID,
    null,
    new Date('2026-05-01T12:00:00Z'),
    new Date('2026-05-01T12:00:00Z')
  );
  return {
    ...mapping,
    identity: null,
    channelStatus: {
      publicationStatus: null,
      lifecycle: 'Unsynced',
      validationMessages: [],
      lastStatusSyncedAt: null,
    },
    commercial: null,
  };
}

function makeSnapshot(externalOfferId: string, status: OfferPublicationStatus): OfferStatusSnapshot {
  return new OfferStatusSnapshot({
    id: `snap-${externalOfferId}`,
    connectionId: CONNECTION_ID,
    externalOfferId,
    internalVariantId: 'ol_variant_x',
    publicationStatus: status,
    statusDetails: null,
    lastStatusSyncedAt: new Date('2026-05-01T12:00:00Z'),
    createdAt: new Date('2026-05-01T12:00:00Z'),
    updatedAt: new Date('2026-05-01T12:00:00Z'),
  });
}

/** OfferManagerPort that supports OfferStatusReader. */
function statusReader(
  resultByOffer: (externalOfferId: string) => OfferStatusReadResult | Promise<never>
): OfferManagerPort {
  return {
    updateOfferQuantity: jest.fn(),
    getOfferStatus: jest.fn((externalOfferId: string) => {
      const result = resultByOffer(externalOfferId);
      return result instanceof Promise ? result : Promise.resolve(result);
    }),
  } as unknown as OfferManagerPort;
}

/** OfferManagerPort that does NOT support OfferStatusReader. */
function nonStatusReader(): OfferManagerPort {
  return { updateOfferQuantity: jest.fn() } as unknown as OfferManagerPort;
}

function readResult(publicationStatus: OfferPublicationStatus): OfferStatusReadResult {
  return { publicationStatus, validationErrors: [] };
}

describe('OfferStatusSyncService', () => {
  let service: OfferStatusSyncService;
  let integrations: jest.Mocked<Pick<IIntegrationsService, 'getCapabilityAdapter'>>;
  let offerMappings: jest.Mocked<Pick<OfferMappingRepositoryPort, 'findMany'>>;
  let snapshots: jest.Mocked<Pick<OfferStatusSnapshotRepositoryPort, 'upsert'>>;
  let commercialSnapshots: jest.Mocked<Pick<OfferCommercialSnapshotRepositoryPort, 'upsert'>>;

  function page(items: OfferMappingListItem[], total: number): PaginatedOfferMappings {
    return { items, total };
  }

  beforeEach(() => {
    integrations = { getCapabilityAdapter: jest.fn() } as unknown as jest.Mocked<
      Pick<IIntegrationsService, 'getCapabilityAdapter'>
    >;
    offerMappings = { findMany: jest.fn() } as unknown as jest.Mocked<
      Pick<OfferMappingRepositoryPort, 'findMany'>
    >;
    // Default: every upsert is a first observation (previousStatus null).
    // Transition tests override the resolved value per case.
    snapshots = {
      upsert: jest
        .fn()
        .mockImplementation((cmd: UpsertOfferStatusSnapshotCommand) =>
          Promise.resolve({
            snapshot: makeSnapshot(cmd.externalOfferId, cmd.publicationStatus),
            previousStatus: null,
          })
        ),
    } as unknown as jest.Mocked<Pick<OfferStatusSnapshotRepositoryPort, 'upsert'>>;
    commercialSnapshots = { upsert: jest.fn() } as unknown as jest.Mocked<
      Pick<OfferCommercialSnapshotRepositoryPort, 'upsert'>
    >;

    service = new OfferStatusSyncService(
      integrations as unknown as IIntegrationsService,
      offerMappings as unknown as OfferMappingRepositoryPort,
      snapshots as unknown as OfferStatusSnapshotRepositoryPort,
      commercialSnapshots as unknown as OfferCommercialSnapshotRepositoryPort
    );
  });

  it('should skip with a zeroed result when the adapter does not support OfferStatusReader', async () => {
    integrations.getCapabilityAdapter.mockResolvedValue(nonStatusReader());

    const result = await service.sync(CONNECTION_ID, { limit: 10 });

    expect(result).toEqual({
      scanned: 0,
      updated: 0,
      transitioned: 0,
      notFound: 0,
      total: 0,
      nextOffset: 0,
    });
    expect(offerMappings.findMany).not.toHaveBeenCalled();
  });

  it('should upsert a snapshot for each mapped offer and report scanned/updated', async () => {
    integrations.getCapabilityAdapter.mockResolvedValue(statusReader(() => readResult('active')));
    offerMappings.findMany.mockResolvedValue(
      page([makeMapping('111', 'ol_variant_a'), makeMapping('222', 'ol_variant_b')], 2)
    );

    const result = await service.sync(CONNECTION_ID, { limit: 10, offset: 0 });

    expect(offerMappings.findMany).toHaveBeenCalledWith(
      { connectionId: CONNECTION_ID },
      { limit: 10, offset: 0 }
    );
    expect(snapshots.upsert).toHaveBeenCalledTimes(2);
    expect(snapshots.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: CONNECTION_ID,
        externalOfferId: '111',
        internalVariantId: 'ol_variant_a',
        publicationStatus: 'active',
      })
    );
    expect(result.scanned).toBe(2);
    expect(result.updated).toBe(2);
    expect(result.transitioned).toBe(0);
  });

  it('should count a transition when the prior snapshot status differs', async () => {
    integrations.getCapabilityAdapter.mockResolvedValue(statusReader(() => readResult('ended')));
    offerMappings.findMany.mockResolvedValue(page([makeMapping('111', 'ol_variant_a')], 1));
    snapshots.upsert.mockResolvedValue({
      snapshot: makeSnapshot('111', 'ended'),
      previousStatus: 'active',
    });

    const result = await service.sync(CONNECTION_ID, { limit: 10 });

    expect(result.transitioned).toBe(1);
    expect(result.updated).toBe(1);
  });

  it('should not count a transition for a first observation (previousStatus null)', async () => {
    integrations.getCapabilityAdapter.mockResolvedValue(statusReader(() => readResult('active')));
    offerMappings.findMany.mockResolvedValue(page([makeMapping('111', 'ol_variant_a')], 1));
    snapshots.upsert.mockResolvedValue({
      snapshot: makeSnapshot('111', 'active'),
      previousStatus: null,
    });

    const result = await service.sync(CONNECTION_ID, { limit: 10 });

    expect(result.transitioned).toBe(0);
    expect(result.updated).toBe(1);
  });

  it('should not count a transition when the status is unchanged', async () => {
    integrations.getCapabilityAdapter.mockResolvedValue(statusReader(() => readResult('active')));
    offerMappings.findMany.mockResolvedValue(page([makeMapping('111', 'ol_variant_a')], 1));
    snapshots.upsert.mockResolvedValue({
      snapshot: makeSnapshot('111', 'active'),
      previousStatus: 'active',
    });

    const result = await service.sync(CONNECTION_ID, { limit: 10 });

    expect(result.transitioned).toBe(0);
    expect(result.updated).toBe(1);
  });

  it('should count notFound and not upsert when the marketplace reports the offer is gone', async () => {
    integrations.getCapabilityAdapter.mockResolvedValue(
      statusReader((externalOfferId) =>
        externalOfferId === '222'
          ? Promise.reject(new OfferNotFoundOnMarketplaceException('222', CONNECTION_ID))
          : readResult('active')
      )
    );
    offerMappings.findMany.mockResolvedValue(
      page([makeMapping('111', 'ol_variant_a'), makeMapping('222', 'ol_variant_b')], 2)
    );

    const result = await service.sync(CONNECTION_ID, { limit: 10 });

    expect(result.scanned).toBe(2);
    expect(result.updated).toBe(1);
    expect(result.notFound).toBe(1);
    expect(snapshots.upsert).toHaveBeenCalledTimes(1);
    expect(snapshots.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ externalOfferId: '111' })
    );
  });

  it('should advance the offset by the page size when more offers remain', async () => {
    integrations.getCapabilityAdapter.mockResolvedValue(statusReader(() => readResult('active')));
    offerMappings.findMany.mockResolvedValue(page([makeMapping('111', 'ol_variant_a')], 50));

    const result = await service.sync(CONNECTION_ID, { limit: 10, offset: 0 });

    expect(result.nextOffset).toBe(10);
    expect(result.total).toBe(50);
  });

  it('should wrap the offset to 0 at the end of the catalog', async () => {
    integrations.getCapabilityAdapter.mockResolvedValue(statusReader(() => readResult('active')));
    offerMappings.findMany.mockResolvedValue(page([makeMapping('991', 'ol_variant_z')], 25));

    const result = await service.sync(CONNECTION_ID, { limit: 10, offset: 20 });

    expect(result.nextOffset).toBe(0);
  });

  it('should propagate non-not-found errors so the runner can retry', async () => {
    integrations.getCapabilityAdapter.mockResolvedValue(
      statusReader(() => Promise.reject(new Error('502 Bad Gateway')))
    );
    offerMappings.findMany.mockResolvedValue(page([makeMapping('111', 'ol_variant_a')], 1));

    await expect(service.sync(CONNECTION_ID, { limit: 10 })).rejects.toThrow('502 Bad Gateway');
  });

  describe('commercial snapshot (#2024)', () => {
    it('upserts offer_commercial_snapshots from an Allegro-shaped commercial observation', async () => {
      integrations.getCapabilityAdapter.mockResolvedValue(
        statusReader(() => ({
          publicationStatus: 'active',
          validationErrors: [],
          commercial: { price: { amount: '99.99', currency: 'PLN' }, availableQuantity: 12 },
        }))
      );
      offerMappings.findMany.mockResolvedValue(page([makeMapping('111', 'ol_variant_a')], 1));

      await service.sync(CONNECTION_ID, { limit: 10 });

      expect(commercialSnapshots.upsert).toHaveBeenCalledTimes(1);
      expect(commercialSnapshots.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionId: CONNECTION_ID,
          externalOfferId: '111',
          internalVariantId: 'ol_variant_a',
          price: '99.99',
          currency: 'PLN',
          availableQuantity: 12,
        })
      );
    });

    it('persists a null price while keeping the observed quantity', async () => {
      integrations.getCapabilityAdapter.mockResolvedValue(
        statusReader(() => ({
          publicationStatus: 'activating',
          validationErrors: [],
          commercial: { price: null, availableQuantity: 16 },
        }))
      );
      offerMappings.findMany.mockResolvedValue(page([makeMapping('222', 'ol_variant_b')], 1));

      await service.sync(CONNECTION_ID, { limit: 10 });

      expect(commercialSnapshots.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          externalOfferId: '222',
          internalVariantId: 'ol_variant_b',
          price: null,
          currency: null,
          availableQuantity: 16,
        })
      );
    });

    it('persists a null quantity rather than a zero when the marketplace reported none', async () => {
      integrations.getCapabilityAdapter.mockResolvedValue(
        statusReader(() => ({
          publicationStatus: 'active',
          validationErrors: [],
          commercial: { price: { amount: '99.99', currency: 'PLN' }, availableQuantity: null },
        }))
      );
      offerMappings.findMany.mockResolvedValue(page([makeMapping('111', 'ol_variant_a')], 1));

      await service.sync(CONNECTION_ID, { limit: 10 });

      expect(commercialSnapshots.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ price: '99.99', availableQuantity: null })
      );
    });

    it('skips the commercial upsert when the observation carries neither price nor quantity', async () => {
      integrations.getCapabilityAdapter.mockResolvedValue(
        statusReader(() => ({
          publicationStatus: 'active',
          validationErrors: [],
          commercial: { price: null, availableQuantity: null },
        }))
      );
      offerMappings.findMany.mockResolvedValue(page([makeMapping('111', 'ol_variant_a')], 1));

      const result = await service.sync(CONNECTION_ID, { limit: 10 });

      expect(commercialSnapshots.upsert).not.toHaveBeenCalled();
      expect(snapshots.upsert).toHaveBeenCalledTimes(1);
      expect(result.commercialUpdated).toBe(0);
      expect(result.commercialFailed).toBe(0);
    });

    it('counts written and failed commercial writes on the result', async () => {
      integrations.getCapabilityAdapter.mockResolvedValue(
        statusReader(() => ({
          publicationStatus: 'active',
          validationErrors: [],
          commercial: { price: { amount: '99.99', currency: 'PLN' }, availableQuantity: 12 },
        }))
      );
      offerMappings.findMany.mockResolvedValue(
        page([makeMapping('111', 'ol_variant_a'), makeMapping('222', 'ol_variant_b')], 2)
      );
      commercialSnapshots.upsert
        .mockResolvedValueOnce(commercialSnapshot())
        .mockRejectedValueOnce(new Error('invalid input syntax for type numeric'));

      const result = await service.sync(CONNECTION_ID, { limit: 10 });

      expect(result.commercialUpdated).toBe(1);
      expect(result.commercialFailed).toBe(1);
    });

    it('skips the commercial upsert but still persists status when the adapter carries no observation', async () => {
      integrations.getCapabilityAdapter.mockResolvedValue(statusReader(() => readResult('active')));
      offerMappings.findMany.mockResolvedValue(page([makeMapping('111', 'ol_variant_a')], 1));

      await service.sync(CONNECTION_ID, { limit: 10 });

      expect(commercialSnapshots.upsert).not.toHaveBeenCalled();
      expect(snapshots.upsert).toHaveBeenCalledTimes(1);
    });

    it('skips the commercial upsert but still persists status on refreshOne when there is no observation', async () => {
      integrations.getCapabilityAdapter.mockResolvedValue(statusReader(() => readResult('active')));

      await service.refreshOne(CONNECTION_ID, {
        externalOfferId: '333',
        internalVariantId: 'ol_variant_c',
      });

      expect(commercialSnapshots.upsert).not.toHaveBeenCalled();
      expect(snapshots.upsert).toHaveBeenCalledTimes(1);
    });

    it('does not abort the page or stall the cursor when the commercial upsert throws', async () => {
      integrations.getCapabilityAdapter.mockResolvedValue(
        statusReader(() => ({
          publicationStatus: 'active',
          validationErrors: [],
          commercial: { price: { amount: '99.99', currency: 'PLN' }, availableQuantity: 12 },
        }))
      );
      offerMappings.findMany.mockResolvedValue(
        page([makeMapping('111', 'ol_variant_a'), makeMapping('222', 'ol_variant_b')], 50)
      );
      commercialSnapshots.upsert.mockRejectedValue(
        new Error('invalid input syntax for type numeric')
      );

      const result = await service.sync(CONNECTION_ID, { limit: 10, offset: 0 });

      expect(snapshots.upsert).toHaveBeenCalledTimes(2);
      expect(result.scanned).toBe(2);
      expect(result.updated).toBe(2);
      expect(result.nextOffset).toBe(10);
    });

    it('does not propagate a commercial upsert failure out of refreshOne', async () => {
      integrations.getCapabilityAdapter.mockResolvedValue(
        statusReader(() => ({
          publicationStatus: 'active',
          validationErrors: [],
          commercial: { price: { amount: '15.50', currency: 'PLN' }, availableQuantity: 4 },
        }))
      );
      commercialSnapshots.upsert.mockRejectedValue(new Error('unique constraint violation'));

      const result = await service.refreshOne(CONNECTION_ID, {
        externalOfferId: '333',
        internalVariantId: 'ol_variant_c',
      });

      expect(result).toBe('active');
      expect(snapshots.upsert).toHaveBeenCalledTimes(1);
    });

    it('upserts the commercial snapshot on refreshOne using the same status response', async () => {
      integrations.getCapabilityAdapter.mockResolvedValue(
        statusReader(() => ({
          publicationStatus: 'active',
          validationErrors: [],
          commercial: { price: { amount: '15.50', currency: 'PLN' }, availableQuantity: 4 },
        }))
      );

      await service.refreshOne(CONNECTION_ID, {
        externalOfferId: '333',
        internalVariantId: 'ol_variant_c',
      });

      expect(commercialSnapshots.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionId: CONNECTION_ID,
          externalOfferId: '333',
          internalVariantId: 'ol_variant_c',
          price: '15.50',
          currency: 'PLN',
          availableQuantity: 4,
        })
      );
    });

    it('does not upsert the commercial snapshot on refreshOne when the offer is not found', async () => {
      integrations.getCapabilityAdapter.mockResolvedValue(
        statusReader(() => Promise.reject(new OfferNotFoundOnMarketplaceException('333', CONNECTION_ID)))
      );

      const result = await service.refreshOne(CONNECTION_ID, {
        externalOfferId: '333',
        internalVariantId: 'ol_variant_c',
      });

      expect(result).toBeNull();
      expect(commercialSnapshots.upsert).not.toHaveBeenCalled();
    });
  });
});
