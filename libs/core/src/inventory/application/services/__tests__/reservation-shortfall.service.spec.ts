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
  publishedReservedQuantity: 3,
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
      listShortfallPositionsByIds: jest.fn().mockResolvedValue([]),
      listHeldForPositions: jest.fn().mockResolvedValue([]),
      listStalePositionIds: jest.fn().mockResolvedValue([]),
      openEpisode: jest.fn().mockResolvedValue(null),
      listOpenEpisodes: jest.fn().mockResolvedValue([]),
      closeEpisode: jest.fn().mockResolvedValue(true),
      listOpenByOrderRecordId: jest.fn().mockResolvedValue([]),
      listOpenByOrderRecordIds: jest.fn().mockResolvedValue([]),
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

    it('should count a re-observed episode as still-open rather than opened, over three consecutive runs', async () => {
      repository.listShortfallPositions.mockResolvedValue([position()]);
      repository.listHeldForPositions.mockResolvedValue([held('ol_order_a', 3, NEWER)]);
      repository.openEpisode
        .mockResolvedValueOnce(episode({ orderRecordId: 'ol_order_a' }))
        // `null` is the repository's contract for "an episode was already open,
        // so its quantities were refreshed and no NEW occurrence was minted".
        //
        // This test pins the SERVICE's counting of that answer and nothing more
        // (#2628 review): the answer is a mock, so it would pass with the
        // partial unique index dropped. The index itself — a re-detection
        // conflicting, the id surviving, the quantities moving — is pinned
        // against a real Postgres in
        // `apps/api/test/integration/reservation-shortfall-episodes.int-spec.ts`,
        // which is the only place it can be.
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
        position({ availableQuantity: 0, publishedReservedQuantity: 5 }),
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
        position({ availableQuantity: 0, publishedReservedQuantity: 4 }),
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
      repository.listShortfallPositionsByIds.mockResolvedValue([]);
      repository.listHeldForPositions.mockResolvedValue([held('ol_order_a', 3, NEWER)]);

      const result = await service.detectShortfalls(RUN);

      expect(result.episodesClosed).toBe(1);
      expect(repository.closeEpisode).toHaveBeenCalledWith('episode-1', 'recovered', NOW);
    });

    it('should close as position-stale, never as recovered, when the master staled the position', async () => {
      // #2628 review. Every shortfall read filters `isStale = false`, so a
      // staled position drops out of `listShortfallPositionsByIds` exactly as a
      // recovered one does. Inferring `'recovered'` from that absence asserts
      // that stock came back for a product #1689 has just established no longer
      // exists — a false all-clear on the one order that certainly cannot be
      // fulfilled.
      repository.listOpenEpisodes.mockResolvedValue([episode({ orderRecordId: 'ol_order_a' })]);
      repository.listShortfallPositionsByIds.mockResolvedValue([]);
      repository.listStalePositionIds.mockResolvedValue([POSITION_ID]);
      repository.listHeldForPositions.mockResolvedValue([held('ol_order_a', 3, NEWER)]);

      const result = await service.detectShortfalls(RUN);

      expect(result.episodesClosed).toBe(1);
      expect(repository.closeEpisode).toHaveBeenCalledWith('episode-1', 'position-stale', NOW);
    });

    it('should prefer reservation-closed over position-stale when the order no longer holds there', async () => {
      // Ordering of the arms: a fact about THIS order's hold is a truer reason
      // than a fact about the position.
      repository.listOpenEpisodes.mockResolvedValue([episode({ orderRecordId: 'ol_order_a' })]);
      repository.listShortfallPositionsByIds.mockResolvedValue([]);
      repository.listStalePositionIds.mockResolvedValue([POSITION_ID]);
      repository.listHeldForPositions.mockResolvedValue([]);

      await service.detectShortfalls(RUN);

      expect(repository.closeEpisode).toHaveBeenCalledWith('episode-1', 'reservation-closed', NOW);
    });

    it('should close by cancellation when the order no longer holds the position, even while it is still short', async () => {
      repository.listOpenEpisodes.mockResolvedValue([episode({ orderRecordId: 'ol_order_a' })]);
      // Still short — for a DIFFERENT order.
      repository.listShortfallPositionsByIds.mockResolvedValue([position()]);
      repository.listHeldForPositions.mockResolvedValue([held('ol_order_other', 3, NEWER)]);

      const result = await service.detectShortfalls(RUN);

      expect(result.episodesClosed).toBe(1);
      // `reservation-closed` wins over `no-longer-attributed`: the order having
      // NO hold here is the more specific and more actionable fact.
      expect(repository.closeEpisode).toHaveBeenCalledWith(
        'episode-1',
        'reservation-closed',
        NOW
      );
    });

    it('should leave a standing episode untouched', async () => {
      repository.listOpenEpisodes.mockResolvedValue([episode({ orderRecordId: 'ol_order_a' })]);
      repository.listShortfallPositionsByIds.mockResolvedValue([position()]);
      repository.listHeldForPositions.mockResolvedValue([held('ol_order_a', 3, NEWER)]);

      const result = await service.detectShortfalls(RUN);

      expect(result.episodesClosed).toBe(0);
      expect(repository.closeEpisode).not.toHaveBeenCalled();
    });

    it('should close as no-longer-attributed after a partial recovery', async () => {
      // Shortfall was 2 across A and B; the master recovered 1, so youngest-first
      // attribution now names only the younger order. B stays held and the
      // position stays short, so neither existing arm fires — without the third
      // reason B's badge would keep asserting a risk nothing recomputes.
      repository.listOpenEpisodes.mockResolvedValue([
        episode({ id: 'ep-older', orderRecordId: 'ol_order_older' }),
      ]);
      repository.listShortfallPositionsByIds.mockResolvedValue([
        position({ availableQuantity: 2, publishedReservedQuantity: 3 }),
      ]);
      repository.listHeldForPositions.mockResolvedValue([
        held('ol_order_younger', 2, NEWER, 'res-younger'),
        held('ol_order_older', 2, OLDER, 'res-older'),
      ]);

      const result = await service.detectShortfalls(RUN);

      expect(result.episodesClosed).toBe(1);
      expect(repository.closeEpisode).toHaveBeenCalledWith(
        'ep-older',
        'no-longer-attributed',
        NOW
      );
    });

    it('should keep an episode the shortfall still lands on', async () => {
      repository.listOpenEpisodes.mockResolvedValue([
        episode({ id: 'ep-younger', orderRecordId: 'ol_order_younger' }),
      ]);
      repository.listShortfallPositionsByIds.mockResolvedValue([
        position({ availableQuantity: 2, publishedReservedQuantity: 3 }),
      ]);
      repository.listHeldForPositions.mockResolvedValue([
        held('ol_order_younger', 2, NEWER, 'res-younger'),
        held('ol_order_older', 2, OLDER, 'res-older'),
      ]);

      const result = await service.detectShortfalls(RUN);

      expect(result.episodesClosed).toBe(0);
    });

    it('should scope the still-short lookup to the page rather than reading the whole set', async () => {
      repository.listOpenEpisodes.mockResolvedValue([episode()]);

      await service.detectShortfalls(RUN);

      // A budget the close half could blow past by reading every short
      // position would make the page cap meaningless.
      expect(repository.listShortfallPositionsByIds).toHaveBeenCalledWith([POSITION_ID]);
    });
  });

  describe('resumption', () => {
    it('should advance both offsets by rows read on a full page', async () => {
      repository.listShortfallPositions.mockResolvedValue([position()]);
      repository.listOpenEpisodes.mockResolvedValue([episode()]);
      repository.listShortfallPositionsByIds.mockResolvedValue([position()]);
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
      repository.listShortfallPositionsByIds.mockResolvedValue([position()]);
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
    it('should take no collaborator beyond the shortfall port and the products read', () => {
      // Half of "no number is clamped anywhere as a side effect" is that there
      // is nothing here that COULD clamp one. A frozen name list could not say
      // that (#2628 review): it broke on a harmless rename and passed happily
      // once a second, stock-writing collaborator was injected, because it
      // asserted about the port and never about the service.
      //
      // Constructor arity is the assertion that actually catches the dangerous
      // change. Adding an inventory repository, a reservation repository or an
      // availability service to this reconciler fails here.
      expect(ReservationShortfallService.length).toBe(2);
    });

    it('should expose only read and episode-scoped methods on its one stock collaborator', () => {
      // The other half: the single stock-facing collaborator must carry no
      // method that could move `availableQuantity`, `olReservedQuantity` or a
      // reservation quantity. Asserted by SHAPE rather than by a frozen list,
      // so renaming `listHeldForPositions` is free while adding, say,
      // `clampReservedQuantity` or `updatePosition` fails.
      const writesOnlyEpisodes = /^(list[A-Z]|openEpisode$|closeEpisode$)/;
      const offenders = Object.keys(repository).filter(
        (method) => !writesOnlyEpisodes.test(method)
      );

      expect(offenders).toEqual([]);
    });
  });

  describe('listOpenForOrders', () => {
    it('should group episodes by order for the list page', async () => {
      repository.listOpenByOrderRecordIds.mockResolvedValue([
        episode({ id: 'ep-1', orderRecordId: 'ol_order_a' }),
        episode({ id: 'ep-2', orderRecordId: 'ol_order_a' }),
        episode({ id: 'ep-3', orderRecordId: 'ol_order_b' }),
      ]);

      const grouped = await service.listOpenForOrders(['ol_order_a', 'ol_order_b']);

      expect(grouped.get('ol_order_a')).toHaveLength(2);
      expect(grouped.get('ol_order_b')).toHaveLength(1);
    });

    it('should not query for an empty page', async () => {
      const grouped = await service.listOpenForOrders([]);

      expect(grouped.size).toBe(0);
      expect(repository.listOpenByOrderRecordIds).not.toHaveBeenCalled();
    });

    it('should omit an order with no open episode rather than mapping it to an empty array', async () => {
      // Absence must stay absence: the consumer reads a missing entry as
      // "nothing reported", never as a positive "this order is fine".
      repository.listOpenByOrderRecordIds.mockResolvedValue([]);

      const grouped = await service.listOpenForOrders(['ol_order_a']);

      expect(grouped.has('ol_order_a')).toBe(false);
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
