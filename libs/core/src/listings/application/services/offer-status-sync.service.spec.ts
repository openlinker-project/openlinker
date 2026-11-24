/**
 * Offer Status Sync Service Tests
 *
 * Covers the steady-state offer-status refresh (#816): per-offer upsert,
 * transition detection, no-capability skip, marketplace-not-found handling,
 * offset advancement + wrap-around, transient-error propagation, and
 * `refreshOne`'s basic contract (#1760) plus its commercial-snapshot side
 * effect (#2024), and the minimum age a not-found read must clear before it
 * is recorded as `ended` (dated from the mapping and the latest creation
 * attempt, sized from the creation poller's budget). Consolidated from a second, duplicate spec file that had
 * grown alongside this one testing the same class (#2032 review, smaller
 * items) - `refreshOne`'s three basic-contract cases below were merged in
 * from there rather than dropped.
 *
 * @module libs/core/src/listings/application/services
 */
import type { ConfigService } from '@nestjs/config';
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

import { OfferCreationRecord } from '../../domain/entities/offer-creation-record.entity';
import { OfferStatusSnapshot } from '../../domain/entities/offer-status-snapshot.entity';
import type { OfferCreationRecordRepositoryPort } from '../../domain/ports/offer-creation-record-repository.port';
import type { OfferPublicationStatus } from '../../domain/types/offer-status-read.types';
import { OFFER_GONE_MIN_AGE_FLOOR_MS, OfferStatusSyncService } from './offer-status-sync.service';

const CONNECTION_ID = 'conn-allegro-1';

/** Long past `OFFER_GONE_MIN_AGE_FLOOR_MS` relative to any real clock. */
const OLD_MAPPING_CREATED_AT = new Date('2026-05-01T12:00:00Z');

function makeMapping(
  externalOfferId: string,
  internalVariantId: string,
  createdAt: Date = OLD_MAPPING_CREATED_AT
): OfferMappingListItem {
  const mapping = new IdentifierMapping(
    `idmap-${externalOfferId}`,
    'Offer',
    internalVariantId,
    externalOfferId,
    'allegro',
    CONNECTION_ID,
    null,
    createdAt,
    createdAt
  );
  return {
    ...mapping,
    identity: null,
    channelStatus: {
      publicationStatus: null,
      lifecycle: 'Unsynced',
      validationMessages: [],
      validationProblems: [],
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

/** A creation attempt for `ol_variant_b` that last moved at `movedAt`. */
function makeCreationRecord(movedAt: Date): OfferCreationRecord {
  return new OfferCreationRecord(
    'ocr-1',
    'ol_variant_b',
    CONNECTION_ID,
    '222',
    'active',
    null,
    true,
    movedAt,
    movedAt
  );
}

/** A `ConfigService` answering only the given keys; the rest fall to defaults. */
function configWith(values: Record<string, number> = {}): ConfigService {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

function readResult(publicationStatus: OfferPublicationStatus): OfferStatusReadResult {
  return { publicationStatus, validationErrors: [] };
}

describe('OfferStatusSyncService', () => {
  let service: OfferStatusSyncService;
  let integrations: jest.Mocked<Pick<IIntegrationsService, 'getCapabilityAdapter'>>;
  let offerMappings: jest.Mocked<Pick<OfferMappingRepositoryPort, 'findMappingPage'>>;
  let snapshots: jest.Mocked<Pick<OfferStatusSnapshotRepositoryPort, 'upsert'>>;
  let commercialSnapshots: jest.Mocked<Pick<OfferCommercialSnapshotRepositoryPort, 'upsert'>>;
  let creationRecords: jest.Mocked<
    Pick<OfferCreationRecordRepositoryPort, 'findLatestByVariantAndConnection'>
  >;

  function buildService(config: ConfigService = configWith()): OfferStatusSyncService {
    return new OfferStatusSyncService(
      integrations as unknown as IIntegrationsService,
      offerMappings as unknown as OfferMappingRepositoryPort,
      snapshots as unknown as OfferStatusSnapshotRepositoryPort,
      commercialSnapshots as unknown as OfferCommercialSnapshotRepositoryPort,
      creationRecords as unknown as OfferCreationRecordRepositoryPort,
      config
    );
  }

  function page(items: OfferMappingListItem[], total: number): PaginatedOfferMappings {
    return { items, total };
  }

  beforeEach(() => {
    integrations = { getCapabilityAdapter: jest.fn() } as unknown as jest.Mocked<
      Pick<IIntegrationsService, 'getCapabilityAdapter'>
    >;
    offerMappings = { findMappingPage: jest.fn() } as unknown as jest.Mocked<
      Pick<OfferMappingRepositoryPort, 'findMappingPage'>
    >;
    // Default: every upsert is a first observation (previousStatus null) that
    // the freshness guard accepts (#2039). Transition and stale-write tests
    // override the resolved value per case.
    snapshots = {
      upsert: jest
        .fn()
        .mockImplementation((cmd: UpsertOfferStatusSnapshotCommand) =>
          Promise.resolve({
            snapshot: makeSnapshot(cmd.externalOfferId, cmd.publicationStatus),
            previousStatus: null,
            applied: true,
          })
        ),
    } as unknown as jest.Mocked<Pick<OfferStatusSnapshotRepositoryPort, 'upsert'>>;
    commercialSnapshots = { upsert: jest.fn() } as unknown as jest.Mocked<
      Pick<OfferCommercialSnapshotRepositoryPort, 'upsert'>
    >;

    // Default: no creation attempt on record (a synced-in offer), so the
    // mapping alone dates it.
    creationRecords = {
      findLatestByVariantAndConnection: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<
      Pick<OfferCreationRecordRepositoryPort, 'findLatestByVariantAndConnection'>
    >;

    service = buildService();
  });

  it('should skip with a zeroed result when the adapter does not support OfferStatusReader', async () => {
    integrations.getCapabilityAdapter.mockResolvedValue(nonStatusReader());

    const result = await service.sync(CONNECTION_ID, { limit: 10 });

    expect(result).toEqual({
      scanned: 0,
      updated: 0,
      transitioned: 0,
      notFound: 0,
      commercialUpdated: 0,
      commercialFailed: 0,
      total: 0,
      nextOffset: 0,
    });
    expect(offerMappings.findMappingPage).not.toHaveBeenCalled();
  });

  it('should upsert a snapshot for each mapped offer and report scanned/updated', async () => {
    integrations.getCapabilityAdapter.mockResolvedValue(statusReader(() => readResult('active')));
    offerMappings.findMappingPage.mockResolvedValue(
      page([makeMapping('111', 'ol_variant_a'), makeMapping('222', 'ol_variant_b')], 2)
    );

    const result = await service.sync(CONNECTION_ID, { limit: 10, offset: 0 });

    expect(offerMappings.findMappingPage).toHaveBeenCalledWith(
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
    offerMappings.findMappingPage.mockResolvedValue(page([makeMapping('111', 'ol_variant_a')], 1));
    snapshots.upsert.mockResolvedValue({
      snapshot: makeSnapshot('111', 'ended'),
      previousStatus: 'active',
      applied: true,
    });

    const result = await service.sync(CONNECTION_ID, { limit: 10 });

    expect(result.transitioned).toBe(1);
    expect(result.updated).toBe(1);
  });

  it('should not count a transition for a first observation (previousStatus null)', async () => {
    integrations.getCapabilityAdapter.mockResolvedValue(statusReader(() => readResult('active')));
    offerMappings.findMappingPage.mockResolvedValue(page([makeMapping('111', 'ol_variant_a')], 1));
    snapshots.upsert.mockResolvedValue({
      snapshot: makeSnapshot('111', 'active'),
      previousStatus: null,
      applied: true,
    });

    const result = await service.sync(CONNECTION_ID, { limit: 10 });

    expect(result.transitioned).toBe(0);
    expect(result.updated).toBe(1);
  });

  it('should not count a transition when the status is unchanged', async () => {
    integrations.getCapabilityAdapter.mockResolvedValue(statusReader(() => readResult('active')));
    offerMappings.findMappingPage.mockResolvedValue(page([makeMapping('111', 'ol_variant_a')], 1));
    snapshots.upsert.mockResolvedValue({
      snapshot: makeSnapshot('111', 'active'),
      previousStatus: 'active',
      applied: true,
    });

    const result = await service.sync(CONNECTION_ID, { limit: 10 });

    expect(result.transitioned).toBe(0);
    expect(result.updated).toBe(1);
  });

  it('should count notFound and record the offer as ended when the marketplace reports it is gone', async () => {
    integrations.getCapabilityAdapter.mockResolvedValue(
      statusReader((externalOfferId) =>
        externalOfferId === '222'
          ? Promise.reject(new OfferNotFoundOnMarketplaceException('222', CONNECTION_ID))
          : readResult('active')
      )
    );
    offerMappings.findMappingPage.mockResolvedValue(
      page([makeMapping('111', 'ol_variant_a'), makeMapping('222', 'ol_variant_b')], 2)
    );

    const result = await service.sync(CONNECTION_ID, { limit: 10 });

    expect(result.scanned).toBe(2);
    expect(result.updated).toBe(2);
    expect(result.notFound).toBe(1);
    expect(snapshots.upsert).toHaveBeenCalledTimes(2);
    expect(snapshots.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ externalOfferId: '111', publicationStatus: 'active' })
    );
    // A vanished offer must become re-listable (the duplicate guard ignores
    // only `ended`), so it is recorded as ended rather than left as it was.
    expect(snapshots.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        externalOfferId: '222',
        internalVariantId: 'ol_variant_b',
        publicationStatus: 'ended',
      })
    );
  });

  describe('not-found minimum age', () => {
    const NOW = new Date('2026-10-26T12:00:00Z').getTime();

    beforeEach(() => {
      jest.spyOn(Date, 'now').mockReturnValue(NOW);
      integrations.getCapabilityAdapter.mockResolvedValue(
        statusReader(() => Promise.reject(new OfferNotFoundOnMarketplaceException('222', CONNECTION_ID)))
      );
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should leave the snapshot untouched when the mapping is younger than the minimum age', async () => {
      // Right after an async 202 create the marketplace may answer 404 for an
      // offer that is about to exist; recording `ended` would let it be
      // listed a second time.
      offerMappings.findMappingPage.mockResolvedValue(
        page([makeMapping('222', 'ol_variant_b', new Date(NOW - OFFER_GONE_MIN_AGE_FLOOR_MS + 1000))], 1)
      );

      const result = await service.sync(CONNECTION_ID, { limit: 10 });

      expect(result.notFound).toBe(1);
      expect(result.updated).toBe(0);
      expect(snapshots.upsert).not.toHaveBeenCalled();
    });

    it('should record ended once the mapping has reached the minimum age', async () => {
      offerMappings.findMappingPage.mockResolvedValue(
        page([makeMapping('222', 'ol_variant_b', new Date(NOW - OFFER_GONE_MIN_AGE_FLOOR_MS))], 1)
      );

      const result = await service.sync(CONNECTION_ID, { limit: 10 });

      expect(result.updated).toBe(1);
      expect(snapshots.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ externalOfferId: '222', publicationStatus: 'ended' })
      );
    });

    it('should return null from refreshOne without writing when the mapping is too young', async () => {
      offerMappings.findMappingPage.mockResolvedValue(
        page([makeMapping('222', 'ol_variant_b', new Date(NOW - 60_000))], 1)
      );

      const result = await service.refreshOne(CONNECTION_ID, {
        externalOfferId: '222',
        internalVariantId: 'ol_variant_b',
      });

      expect(result).toBeNull();
      expect(snapshots.upsert).not.toHaveBeenCalled();
    });

    it('should record ended from refreshOne once the mapping has reached the minimum age', async () => {
      offerMappings.findMappingPage.mockResolvedValue(
        page([makeMapping('222', 'ol_variant_b', new Date(NOW - OFFER_GONE_MIN_AGE_FLOOR_MS))], 1)
      );

      const result = await service.refreshOne(CONNECTION_ID, {
        externalOfferId: '222',
        internalVariantId: 'ol_variant_b',
      });

      expect(result).toBe('ended');
      expect(offerMappings.findMappingPage).toHaveBeenCalledWith(
        { connectionId: CONNECTION_ID, internalId: 'ol_variant_b', search: '222' },
        { limit: 100, offset: 0 }
      );
      expect(snapshots.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ externalOfferId: '222', publicationStatus: 'ended' })
      );
    });

    it('should not trust a not-found from refreshOne when no exact mapping dates the offer', async () => {
      // The substring search matched only a different offer id.
      offerMappings.findMappingPage.mockResolvedValue(
        page([makeMapping('2220', 'ol_variant_b')], 1)
      );

      const result = await service.refreshOne(CONNECTION_ID, {
        externalOfferId: '222',
        internalVariantId: 'ol_variant_b',
      });

      expect(result).toBeNull();
      expect(snapshots.upsert).not.toHaveBeenCalled();
    });

    it('should let the mapping age decide when the variant has no creation attempt', async () => {
      offerMappings.findMappingPage.mockResolvedValue(
        page([makeMapping('222', 'ol_variant_b', new Date(NOW - OFFER_GONE_MIN_AGE_FLOOR_MS))], 1)
      );

      const result = await service.sync(CONNECTION_ID, { limit: 10 });

      expect(creationRecords.findLatestByVariantAndConnection).toHaveBeenCalledWith(
        'ol_variant_b',
        CONNECTION_ID
      );
      expect(result.updated).toBe(1);
    });

    it('should not record ended when an old mapping belongs to a freshly re-created offer', async () => {
      // A source whose offer id survives a re-create (Erli uses the variant
      // id) reuses the old mapping; the new attempt is what dates the offer.
      offerMappings.findMappingPage.mockResolvedValue(
        page([makeMapping('222', 'ol_variant_b', OLD_MAPPING_CREATED_AT)], 1)
      );
      creationRecords.findLatestByVariantAndConnection.mockResolvedValue(
        makeCreationRecord(new Date(NOW - 60_000))
      );

      const result = await service.sync(CONNECTION_ID, { limit: 10 });

      expect(result.notFound).toBe(1);
      expect(result.updated).toBe(0);
      expect(snapshots.upsert).not.toHaveBeenCalled();
    });

    it('should not record ended from refreshOne for a freshly re-created offer', async () => {
      offerMappings.findMappingPage.mockResolvedValue(
        page([makeMapping('222', 'ol_variant_b', OLD_MAPPING_CREATED_AT)], 1)
      );
      creationRecords.findLatestByVariantAndConnection.mockResolvedValue(
        makeCreationRecord(new Date(NOW - 60_000))
      );

      const result = await service.refreshOne(CONNECTION_ID, {
        externalOfferId: '222',
        internalVariantId: 'ol_variant_b',
      });

      expect(result).toBeNull();
      expect(snapshots.upsert).not.toHaveBeenCalled();
    });

    it('should record ended when both the mapping and the latest creation attempt are old', async () => {
      offerMappings.findMappingPage.mockResolvedValue(
        page([makeMapping('222', 'ol_variant_b', OLD_MAPPING_CREATED_AT)], 1)
      );
      creationRecords.findLatestByVariantAndConnection.mockResolvedValue(
        makeCreationRecord(new Date(NOW - OFFER_GONE_MIN_AGE_FLOOR_MS))
      );

      const result = await service.sync(CONNECTION_ID, { limit: 10 });

      expect(result.updated).toBe(1);
      expect(snapshots.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ externalOfferId: '222', publicationStatus: 'ended' })
      );
    });

    it('should treat the offer as too young when the creation attempt cannot be read', async () => {
      offerMappings.findMappingPage.mockResolvedValue(
        page([makeMapping('222', 'ol_variant_b', OLD_MAPPING_CREATED_AT)], 1)
      );
      creationRecords.findLatestByVariantAndConnection.mockRejectedValue(new Error('db down'));

      const result = await service.sync(CONNECTION_ID, { limit: 10 });

      expect(result.notFound).toBe(1);
      expect(result.updated).toBe(0);
      expect(snapshots.upsert).not.toHaveBeenCalled();
    });

    it('should raise the threshold to three poller budgets when the poller runs longer than the floor', async () => {
      // 12 attempts capped at 10 minutes each: 5 + 10 + 20 + 40 + 80 + 160 +
      // 320 + 5 x 600 seconds = 3635 s, so three budgets is about 3 hours.
      service = buildService(configWith({ OL_ALLEGRO_OFFER_POLL_MAX_DELAY_SECONDS: 600 }));
      const threeBudgetsMs = 3 * 3635 * 1000;
      offerMappings.findMappingPage.mockResolvedValue(
        page([makeMapping('222', 'ol_variant_b', new Date(NOW - threeBudgetsMs + 1000))], 1)
      );

      const young = await service.sync(CONNECTION_ID, { limit: 10 });
      expect(young.updated).toBe(0);

      offerMappings.findMappingPage.mockResolvedValue(
        page([makeMapping('222', 'ol_variant_b', new Date(NOW - threeBudgetsMs))], 1)
      );

      const old = await service.sync(CONNECTION_ID, { limit: 10 });
      expect(old.updated).toBe(1);
    });
  });

  it('should advance the offset by the page size when more offers remain', async () => {
    integrations.getCapabilityAdapter.mockResolvedValue(statusReader(() => readResult('active')));
    offerMappings.findMappingPage.mockResolvedValue(page([makeMapping('111', 'ol_variant_a')], 50));

    const result = await service.sync(CONNECTION_ID, { limit: 10, offset: 0 });

    expect(result.nextOffset).toBe(10);
    expect(result.total).toBe(50);
  });

  it('should wrap the offset to 0 at the end of the catalog', async () => {
    integrations.getCapabilityAdapter.mockResolvedValue(statusReader(() => readResult('active')));
    offerMappings.findMappingPage.mockResolvedValue(page([makeMapping('991', 'ol_variant_z')], 25));

    const result = await service.sync(CONNECTION_ID, { limit: 10, offset: 20 });

    expect(result.nextOffset).toBe(0);
  });

  it('should propagate non-not-found errors so the runner can retry', async () => {
    integrations.getCapabilityAdapter.mockResolvedValue(
      statusReader(() => Promise.reject(new Error('502 Bad Gateway')))
    );
    offerMappings.findMappingPage.mockResolvedValue(page([makeMapping('111', 'ol_variant_a')], 1));

    await expect(service.sync(CONNECTION_ID, { limit: 10 })).rejects.toThrow('502 Bad Gateway');
  });

  describe('refreshOne (#1760)', () => {
    const target = { externalOfferId: '7781896308', internalVariantId: 'ol_variant_1' };

    it('should upsert and return the live status when the adapter supports OfferStatusReader', async () => {
      integrations.getCapabilityAdapter.mockResolvedValue(statusReader(() => readResult('active')));
      snapshots.upsert.mockResolvedValue({
        snapshot: makeSnapshot('7781896308', 'active'),
        previousStatus: 'inactive',
      applied: true,
      });

      const result = await service.refreshOne(CONNECTION_ID, target);

      expect(snapshots.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionId: CONNECTION_ID,
          externalOfferId: '7781896308',
          internalVariantId: 'ol_variant_1',
          publicationStatus: 'active',
        })
      );
      expect(result).toBe('active');
    });

    it('should return null when the adapter does not support OfferStatusReader', async () => {
      integrations.getCapabilityAdapter.mockResolvedValue(nonStatusReader());

      const result = await service.refreshOne(CONNECTION_ID, target);

      expect(result).toBeNull();
      expect(snapshots.upsert).not.toHaveBeenCalled();
    });

    it('should record the offer as ended when it is not found on the marketplace', async () => {
      integrations.getCapabilityAdapter.mockResolvedValue(
        statusReader(() =>
          Promise.reject(new OfferNotFoundOnMarketplaceException('7781896308', CONNECTION_ID))
        )
      );
      offerMappings.findMappingPage.mockResolvedValue(
        page([makeMapping('7781896308', 'ol_variant_1')], 1)
      );

      const result = await service.refreshOne(CONNECTION_ID, target);

      expect(result).toBe('ended');
      expect(snapshots.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ externalOfferId: target.externalOfferId, publicationStatus: 'ended' })
      );
    });
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
      offerMappings.findMappingPage.mockResolvedValue(page([makeMapping('111', 'ol_variant_a')], 1));

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
      offerMappings.findMappingPage.mockResolvedValue(page([makeMapping('222', 'ol_variant_b')], 1));

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
      offerMappings.findMappingPage.mockResolvedValue(page([makeMapping('111', 'ol_variant_a')], 1));

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
      offerMappings.findMappingPage.mockResolvedValue(page([makeMapping('111', 'ol_variant_a')], 1));

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
      offerMappings.findMappingPage.mockResolvedValue(
        page([makeMapping('111', 'ol_variant_a'), makeMapping('222', 'ol_variant_b')], 2)
      );
      commercialSnapshots.upsert
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('invalid input syntax for type numeric'));

      const result = await service.sync(CONNECTION_ID, { limit: 10 });

      expect(result.commercialUpdated).toBe(1);
      expect(result.commercialFailed).toBe(1);
    });

    it('skips the commercial upsert but still persists status when the adapter carries no observation', async () => {
      integrations.getCapabilityAdapter.mockResolvedValue(statusReader(() => readResult('active')));
      offerMappings.findMappingPage.mockResolvedValue(page([makeMapping('111', 'ol_variant_a')], 1));

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
      offerMappings.findMappingPage.mockResolvedValue(
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
      offerMappings.findMappingPage.mockResolvedValue(page([makeMapping('333', 'ol_variant_c')], 1));

      const result = await service.refreshOne(CONNECTION_ID, {
        externalOfferId: '333',
        internalVariantId: 'ol_variant_c',
      });

      expect(result).toBe('ended');
      expect(commercialSnapshots.upsert).not.toHaveBeenCalled();
    });

    it('does not upsert the commercial snapshot when the status write was discarded as stale', async () => {
      integrations.getCapabilityAdapter.mockResolvedValue(
        statusReader(() => ({
          publicationStatus: 'active',
          validationErrors: [],
          commercial: { price: { amount: '15.50', currency: 'PLN' }, availableQuantity: 4 },
        }))
      );
      snapshots.upsert.mockResolvedValue({
        snapshot: makeSnapshot('333', 'active'),
        previousStatus: 'active',
        applied: false,
      });

      await service.refreshOne(CONNECTION_ID, {
        externalOfferId: '333',
        internalVariantId: 'ol_variant_c',
      });

      expect(commercialSnapshots.upsert).not.toHaveBeenCalled();
    });
  });

  describe('recordObservedStatus (#2039)', () => {
    const target = { externalOfferId: '111', internalVariantId: 'ol_variant_1' };

    it('should upsert a status the caller already observed, without reading the marketplace', async () => {
      await service.recordObservedStatus(CONNECTION_ID, target, {
        publicationStatus: 'active',
        validationMessages: [],
        validationProblems: [],
      });

      expect(integrations.getCapabilityAdapter).not.toHaveBeenCalled();
      expect(snapshots.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionId: CONNECTION_ID,
          externalOfferId: '111',
          internalVariantId: 'ol_variant_1',
          publicationStatus: 'active',
          statusDetails: null,
        }) as UpsertOfferStatusSnapshotCommand
      );
    });

    it('should persist observed validation messages as status details', async () => {
      // No structured half: the flattened sentences carry no code, no summary
      // and offer scope, so `validationProblems` would say nothing they do not -
      // and writing it would stop every reader's "absent ⇒ fall back to
      // validationMessages" path from ever firing (#2231 review).
      await service.recordObservedStatus(CONNECTION_ID, target, {
        publicationStatus: 'inactive',
        validationMessages: ['Missing parameter'],
      });

      expect(snapshots.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          statusDetails: { validationMessages: ['Missing parameter'] },
        }) as UpsertOfferStatusSnapshotCommand
      );
    });

    it('should persist the structured half as soon as it carries anything the messages do not', async () => {
      await service.recordObservedStatus(CONNECTION_ID, target, {
        publicationStatus: 'inactive',
        validationProblems: [
          { code: 'shopKyc', message: 'Finish verification.', scope: 'account' },
        ],
      });

      expect(snapshots.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          statusDetails: {
            validationMessages: ['Finish verification.'],
            validationProblems: [
              { code: 'shopKyc', message: 'Finish verification.', scope: 'account' },
            ],
          },
        }) as UpsertOfferStatusSnapshotCommand
      );
    });

    it('should stamp the caller-supplied observation time so the freshness guard can order writes', async () => {
      const observedAt = new Date('2026-08-12T10:00:00Z');

      await service.recordObservedStatus(CONNECTION_ID, target, {
        publicationStatus: 'activating',
        observedAt,
      });

      expect(snapshots.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          lastStatusSyncedAt: observedAt,
        }) as UpsertOfferStatusSnapshotCommand
      );
    });

    it('should report the write as not applied when the freshness guard discarded it', async () => {
      snapshots.upsert.mockResolvedValue({
        snapshot: makeSnapshot('111', 'active'),
        previousStatus: 'active',
        applied: false,
      });

      const applied = await service.recordObservedStatus(CONNECTION_ID, target, {
        publicationStatus: 'active',
      });

      expect(applied).toBe(false);
    });
  });

});
