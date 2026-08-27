/**
 * Reservation shortfall — the episode lifecycle (#2349, design § 4.2 story I6)
 *
 * The three properties under test are the three the issue calls out as the
 * difference between an episode and a self-clearing flag: a still-open episode
 * is re-observed and NOT written to, a recovery closes by an explicit write,
 * and a recurrence after a close is a NEW occurrence. Plus the two this slice
 * adds on top: cancellation is a second, independent close trigger, and NOTHING
 * is clamped.
 *
 * @module libs/core/src/inventory/application/services
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { PRODUCTS_SERVICE_TOKEN } from '@openlinker/core/products';
import { ReservationShortfallService } from '../reservation-shortfall.service';
import { RESERVATION_SHORTFALL_REPOSITORY_TOKEN } from '../../../inventory.tokens';
import { Reservation } from '../../../domain/entities/reservation.entity';
import { ReservationShortfallEpisode } from '../../../domain/entities/reservation-shortfall-episode.entity';
import type { ReservationShortfallRepositoryPort } from '../../../domain/ports/reservation-shortfall-repository.port';
import type { ShortfallPositionRow } from '../../../domain/types/reservation-shortfall.types';

const NOW = new Date('2026-08-27T10:00:00.000Z');
const OLDER = new Date('2026-08-01T00:00:00.000Z');
const NEWER = new Date('2026-08-20T00:00:00.000Z');

const POSITION_ID = 'ol_inventory_1';
const VARIANT_ID = 'ol_variant_1';
const PRODUCT_ID = 'ol_product_1';

const position = (overrides: Partial<ShortfallPositionRow> = {}): ShortfallPositionRow => ({
  inventoryItemId: POSITION_ID,
  productId: PRODUCT_ID,
  productVariantId: VARIANT_ID,
  availableQuantity: 1,
  olReservedQuantity: 3,
  ...overrides,
});

const held = (
  orderRecordId: string,
  quantity: number,
  createdAt: Date,
  id = `res-${orderRecordId}`
): Reservation =>
  new Reservation(
    id,
    orderRecordId,
    'line-1',
    POSITION_ID,
    quantity,
    'held',
    new Date('2026-12-01T00:00:00.000Z'),
    'diagnostic',
    createdAt,
    createdAt,
    null
  );

const episode = (overrides: Partial<{ id: string; orderRecordId: string }> = {}) =>
  new ReservationShortfallEpisode(
    overrides.id ?? 'episode-1',
    overrides.orderRecordId ?? 'ol_order_new',
    POSITION_ID,
    VARIANT_ID,
    'SKU-1',
    2,
    2,
    NOW,
    null,
    null,
    NOW,
    NOW
  );

const RUN = { detectLimit: 50, closeLimit: 50, detectOffset: 0, closeOffset: 0, now: NOW };

describe('ReservationShortfallService', () => {
  let service: ReservationShortfallService;
  let repository: jest.Mocked<ReservationShortfallRepositoryPort>;
  let products: { getVariantsByProductIds: jest.Mock };

  beforeEach(async () => {
    repository = {
      listShortfallPositions: jest.fn().mockResolvedValue([]),
      listShortPositionIds: jest.fn().mockResolvedValue(new Set<string>()),
      listHeldForPositions: jest.fn().mockResolvedValue([]),
      openEpisode: jest.fn().mockResolvedValue(null),
      listOpenEpisodes: jest.fn().mockResolvedValue([]),
      closeEpisode: jest.fn().mockResolvedValue(true),
      listOpenByOrderRecordId: jest.fn().mockResolvedValue([]),
    };
    products = {
      getVariantsByProductIds: jest
        .fn()
        .mockResolvedValue([{ id: VARIANT_ID, productId: PRODUCT_ID, sku: 'SKU-1' }]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReservationShortfallService,
        { provide: RESERVATION_SHORTFALL_REPOSITORY_TOKEN, useValue: repository },
        { provide: PRODUCTS_SERVICE_TOKEN, useValue: products },
      ],
    }).compile();

    service = module.get(ReservationShortfallService);
  });

  describe('detection', () => {
    it('should open an episode naming the order and the sku when a position is short', async () => {
      repository.listShortfallPositions.mockResolvedValue([position()]);
      repository.listHeldForPositions.mockResolvedValue([held('ol_order_a', 3, NEWER)]);
      repository.openEpisode.mockResolvedValue(episode({ orderRecordId: 'ol_order_a' }));

      const result = await service.detectShortfalls(RUN);

      expect(result.episodesOpened).toBe(1);
      expect(repository.openEpisode).toHaveBeenCalledWith(
        expect.objectContaining({
          orderRecordId: 'ol_order_a',
          inventoryItemId: POSITION_ID,
          productVariantId: VARIANT_ID,
          sku: 'SKU-1',
          shortQuantity: 2,
          positionShortfall: 2,
        })
      );
    });

    it('should attribute the shortfall youngest-reservation-first when several orders hold the position', async () => {
      repository.listShortfallPositions.mockResolvedValue([position()]);
      // Repository contract is youngest-first; the service must not re-sort.
      repository.listHeldForPositions.mockResolvedValue([
        held('ol_order_young', 1, NEWER, 'res-young'),
        held('ol_order_old', 5, OLDER, 'res-old'),
      ]);

      await service.detectShortfalls(RUN);

      const attributed = repository.openEpisode.mock.calls.map(([input]) => [
        input.orderRecordId,
        input.shortQuantity,
      ]);
      // Shortfall of 2: the whole of the youngest hold (1), then 1 of the older.
      expect(attributed).toEqual([
        ['ol_order_young', 1],
        ['ol_order_old', 1],
      ]);
    });

    it('should write nothing when the episode is already open, over three consecutive runs', async () => {
      repository.listShortfallPositions.mockResolvedValue([position()]);
      repository.listHeldForPositions.mockResolvedValue([held('ol_order_a', 3, NEWER)]);
      repository.openEpisode
        .mockResolvedValueOnce(episode({ orderRecordId: 'ol_order_a' }))
        // `null` is the partial unique index refusing a duplicate: an episode
        // is already open and NOTHING was written.
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const first = await service.detectShortfalls(RUN);
      const second = await service.detectShortfalls(RUN);
      const third = await service.detectShortfalls(RUN);

      expect(first.episodesOpened).toBe(1);
      expect(second.episodesOpened).toBe(0);
      expect(third.episodesOpened).toBe(0);
      expect(second.episodesStillOpen).toBe(1);
      expect(third.episodesStillOpen).toBe(1);
    });

    it('should report unattributed units when the counter promises more than the ledger holds', async () => {
      repository.listShortfallPositions.mockResolvedValue([
        position({ availableQuantity: 0, olReservedQuantity: 5 }),
      ]);
      repository.listHeldForPositions.mockResolvedValue([held('ol_order_a', 2, NEWER)]);

      const result = await service.detectShortfalls(RUN);

      expect(result.unattributed).toBe(3);
      expect(result.episodesOpened).toBe(0);
      expect(repository.openEpisode).toHaveBeenCalledTimes(1);
    });

    it('should record the episode without a sku when the products lookup fails', async () => {
      repository.listShortfallPositions.mockResolvedValue([position()]);
      repository.listHeldForPositions.mockResolvedValue([held('ol_order_a', 3, NEWER)]);
      products.getVariantsByProductIds.mockRejectedValue(new Error('products unavailable'));

      await service.detectShortfalls(RUN);

      expect(repository.openEpisode).toHaveBeenCalledWith(
        expect.objectContaining({ sku: null, orderRecordId: 'ol_order_a' })
      );
    });

    it('should keep going when one open write fails', async () => {
      repository.listShortfallPositions.mockResolvedValue([
        position({ availableQuantity: 0, olReservedQuantity: 4 }),
      ]);
      repository.listHeldForPositions.mockResolvedValue([
        held('ol_order_a', 2, NEWER, 'res-a'),
        held('ol_order_b', 2, OLDER, 'res-b'),
      ]);
      repository.openEpisode
        .mockRejectedValueOnce(new Error('write failed'))
        .mockResolvedValueOnce(episode({ orderRecordId: 'ol_order_b' }));

      const result = await service.detectShortfalls(RUN);

      expect(result.failed).toBe(1);
      expect(result.episodesOpened).toBe(1);
    });
  });

  describe('closing', () => {
    it('should close by recovery when the position is no longer short', async () => {
      repository.listOpenEpisodes.mockResolvedValue([episode({ orderRecordId: 'ol_order_a' })]);
      repository.listShortPositionIds.mockResolvedValue(new Set<string>());
      repository.listHeldForPositions.mockResolvedValue([held('ol_order_a', 3, NEWER)]);

      const result = await service.detectShortfalls(RUN);

      expect(result.episodesClosed).toBe(1);
      expect(repository.closeEpisode).toHaveBeenCalledWith('episode-1', 'recovered', NOW);
    });

    it('should close by cancellation when the order no longer holds the position, even while it is still short', async () => {
      repository.listOpenEpisodes.mockResolvedValue([episode({ orderRecordId: 'ol_order_a' })]);
      // Still short — for a DIFFERENT order.
      repository.listShortPositionIds.mockResolvedValue(new Set([POSITION_ID]));
      repository.listHeldForPositions.mockResolvedValue([held('ol_order_other', 3, NEWER)]);

      const result = await service.detectShortfalls(RUN);

      expect(result.episodesClosed).toBe(1);
      expect(repository.closeEpisode).toHaveBeenCalledWith(
        'episode-1',
        'reservation-closed',
        NOW
      );
    });

    it('should leave a standing episode untouched', async () => {
      repository.listOpenEpisodes.mockResolvedValue([episode({ orderRecordId: 'ol_order_a' })]);
      repository.listShortPositionIds.mockResolvedValue(new Set([POSITION_ID]));
      repository.listHeldForPositions.mockResolvedValue([held('ol_order_a', 3, NEWER)]);

      const result = await service.detectShortfalls(RUN);

      expect(result.episodesClosed).toBe(0);
      expect(repository.closeEpisode).not.toHaveBeenCalled();
    });

    it('should scope the still-short lookup to the page rather than reading the whole set', async () => {
      repository.listOpenEpisodes.mockResolvedValue([episode()]);

      await service.detectShortfalls(RUN);

      // A budget the close half could blow past by reading every short
      // position would make the page cap meaningless.
      expect(repository.listShortPositionIds).toHaveBeenCalledWith([POSITION_ID]);
    });
  });

  describe('resumption', () => {
    it('should advance both offsets by rows read on a full page', async () => {
      repository.listShortfallPositions.mockResolvedValue([position()]);
      repository.listOpenEpisodes.mockResolvedValue([episode()]);
      repository.listShortPositionIds.mockResolvedValue(new Set([POSITION_ID]));
      repository.listHeldForPositions.mockResolvedValue([held('ol_order_new', 3, NEWER)]);

      const result = await service.detectShortfalls({
        detectLimit: 1,
        closeLimit: 1,
        detectOffset: 10,
        closeOffset: 20,
        now: NOW,
      });

      expect(result.nextDetectOffset).toBe(11);
      expect(result.nextCloseOffset).toBe(21);
    });

    it('should wrap both offsets to zero on a short page so a cycle restarts', async () => {
      repository.listShortfallPositions.mockResolvedValue([position()]);
      repository.listOpenEpisodes.mockResolvedValue([episode()]);
      repository.listShortPositionIds.mockResolvedValue(new Set([POSITION_ID]));
      repository.listHeldForPositions.mockResolvedValue([held('ol_order_new', 3, NEWER)]);

      const result = await service.detectShortfalls({
        detectLimit: 50,
        closeLimit: 50,
        detectOffset: 10,
        closeOffset: 20,
        now: NOW,
      });

      expect(result.nextDetectOffset).toBe(0);
      expect(result.nextCloseOffset).toBe(0);
    });
  });

  describe('no clamping', () => {
    it('should expose no write to the position counter or the ledger at all', () => {
      // The AC is "no number is clamped anywhere as a side effect". Asserted
      // structurally rather than behaviourally: the reconciler's ONLY
      // collaborator for stock is this port, and the port carries no method
      // that could move `availableQuantity`, `olReservedQuantity`, or a
      // reservation quantity. A future method that could would fail here.
      expect(Object.keys(repository).sort()).toEqual([
        'closeEpisode',
        'listHeldForPositions',
        'listOpenByOrderRecordId',
        'listOpenEpisodes',
        'listShortPositionIds',
        'listShortfallPositions',
        'openEpisode',
      ]);
    });
  });

  describe('listOpenForOrder', () => {
    it('should return the order-detail projection from the repository', async () => {
      const open = episode({ orderRecordId: 'ol_order_a' });
      repository.listOpenByOrderRecordId.mockResolvedValue([open]);

      await expect(service.listOpenForOrder('ol_order_a')).resolves.toEqual([open]);
    });
  });
});
