/**
 * Reservation Shortfall Service (#2349, design § 4.2 story I6)
 *
 * The reconciler that turns "the master dropped below what we promised" into a
 * named order, a named sku, and a number — as a persisted EPISODE with a stable
 * occurrence id, not a self-clearing flag.
 *
 * Two properties are load-bearing rather than incidental.
 *
 * **The episode is the unit, and its id is stable because an INDEX says so.**
 * A shortfall is a *standing* condition — this pass re-observes it on every run
 * for as long as it lasts. Stored as "currently true", automation trigger T8
 * (`W2-23`, `edge`-classified) would have nothing to build an idempotency key
 * from and would degrade into firing on every recompute: the hourly-email bug.
 * The partial unique index makes a re-detection CONFLICT and write nothing, so
 * the id survives untouched for the life of the condition and a recurrence
 * after a close mints a new one.
 *
 * **It repairs nothing.** No write to `inventory_items`, none to
 * `reservations`. Clamping the counter would make the numbers agree and the
 * fact disappear, which is precisely what design § 4.2 declined the
 * `olReserved <= available` CHECK in order to keep possible.
 *
 * @module libs/core/src/inventory/application/services
 * @implements {IReservationShortfallService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import { PRODUCTS_SERVICE_TOKEN, type IProductsService } from '@openlinker/core/products';
import { RESERVATION_SHORTFALL_REPOSITORY_TOKEN } from '../../inventory.tokens';
import { ReservationShortfallRepositoryPort } from '../../domain/ports/reservation-shortfall-repository.port';
import type { ReservationShortfallEpisode } from '../../domain/entities/reservation-shortfall-episode.entity';
import type { Reservation } from '../../domain/entities/reservation.entity';
import type {
  DetectShortfallsResult,
  ShortfallAttribution,
  ShortfallPositionRow,
} from '../../domain/types/reservation-shortfall.types';
import type {
  DetectShortfallsInput,
  IReservationShortfallService,
} from './reservation-shortfall.service.interface';

@Injectable()
export class ReservationShortfallService implements IReservationShortfallService {
  private readonly logger = new Logger(ReservationShortfallService.name);

  constructor(
    @Inject(RESERVATION_SHORTFALL_REPOSITORY_TOKEN)
    private readonly shortfalls: ReservationShortfallRepositoryPort,
    @Inject(PRODUCTS_SERVICE_TOKEN)
    private readonly products: IProductsService
  ) {}

  async detectShortfalls(input: DetectShortfallsInput): Promise<DetectShortfallsResult> {
    // Resolved ONCE per run, so every episode opened or closed in this run
    // carries the same instant and two rows cannot disagree about "now".
    const now = input.now ?? new Date();

    const detection = await this.runDetection(input, now);
    const closing = await this.runClose(input, now);

    return {
      positionsExamined: detection.positionsExamined,
      episodesOpened: detection.episodesOpened,
      episodesStillOpen: detection.episodesStillOpen,
      episodesExamined: closing.episodesExamined,
      episodesClosed: closing.episodesClosed,
      unattributed: detection.unattributed,
      failed: detection.failed + closing.failed,
      nextDetectOffset: detection.nextOffset,
      nextCloseOffset: closing.nextOffset,
    };
  }

  async listOpenForOrder(
    orderRecordId: string
  ): Promise<readonly ReservationShortfallEpisode[]> {
    return this.shortfalls.listOpenByOrderRecordId(orderRecordId);
  }

  async listOpenForOrders(
    orderRecordIds: readonly string[]
  ): Promise<ReadonlyMap<string, readonly ReservationShortfallEpisode[]>> {
    const grouped = new Map<string, ReservationShortfallEpisode[]>();
    if (orderRecordIds.length === 0) {
      return grouped;
    }

    const episodes = await this.shortfalls.listOpenByOrderRecordIds(orderRecordIds);
    for (const episode of episodes) {
      const bucket = grouped.get(episode.orderRecordId);
      if (bucket === undefined) {
        grouped.set(episode.orderRecordId, [episode]);
      } else {
        bucket.push(episode);
      }
    }
    return grouped;
  }

  /**
   * The detection half: positions short right now, attributed to orders.
   *
   * The scan offset advances by rows READ. This pass repairs nothing, so a
   * short position STAYS in the predicate across runs — frontier-as-query
   * (which the expiry sweep correctly uses, because every page there consumes
   * its own selection) would re-read the same head page forever and never reach
   * the tail.
   */
  private async runDetection(
    input: DetectShortfallsInput,
    now: Date
  ): Promise<{
    positionsExamined: number;
    episodesOpened: number;
    episodesStillOpen: number;
    unattributed: number;
    failed: number;
    nextOffset: number;
  }> {
    const positions = await this.shortfalls.listShortfallPositions(
      input.detectLimit,
      input.detectOffset
    );

    if (positions.length === 0) {
      // A short page means the end of the set: wrap, so the next tick starts a
      // fresh cycle rather than paging off the end forever.
      return {
        positionsExamined: 0,
        episodesOpened: 0,
        episodesStillOpen: 0,
        unattributed: 0,
        failed: 0,
        nextOffset: 0,
      };
    }

    const held = await this.shortfalls.listHeldForPositions(
      positions.map((position) => position.inventoryItemId)
    );
    const heldByPosition = this.groupByPosition(held);
    const skuByVariantId = await this.resolveSkus(positions);

    let episodesOpened = 0;
    let episodesStillOpen = 0;
    let unattributed = 0;
    let failed = 0;

    for (const position of positions) {
      const positionShortfall = position.olReservedQuantity - position.availableQuantity;
      const attributions = this.attribute(
        positionShortfall,
        heldByPosition.get(position.inventoryItemId) ?? []
      );

      const attributed = attributions.reduce((sum, item) => sum + item.shortQuantity, 0);
      const residue = positionShortfall - attributed;
      if (residue > 0) {
        // The counter says more is promised than the ledger can account for.
        // There is no order to name for those units, so no episode is written
        // — but the disagreement is a defect signal and is never silent.
        unattributed += residue;
        this.warnUnattributable(position, positionShortfall, residue);
      }

      for (const attribution of attributions) {
        try {
          const episode = await this.shortfalls.openEpisode({
            orderRecordId: attribution.orderRecordId,
            inventoryItemId: position.inventoryItemId,
            productVariantId: position.productVariantId,
            sku:
              position.productVariantId === null
                ? null
                : (skuByVariantId.get(position.productVariantId) ?? null),
            shortQuantity: attribution.shortQuantity,
            positionShortfall,
            openedAt: now,
          });

          // `null` is the partial index doing its job: an episode is already
          // open for this key and NOTHING was written. That is the property
          // T8's idempotency key rests on, so it is counted, not ignored.
          if (episode === null) {
            episodesStillOpen += 1;
          } else {
            episodesOpened += 1;
          }
        } catch (error) {
          // Per-candidate, never fatal: one bad row must not abort a run that
          // can still handle the rest of its page. The position stays short, so
          // it is re-read on the next cycle — nothing is lost, only delayed.
          failed += 1;
          this.logger.error(
            `reservation_shortfall_open_failed order=${attribution.orderRecordId} ` +
              `position=${position.inventoryItemId}`,
            (error as Error).stack
          );
        }
      }
    }

    return {
      positionsExamined: positions.length,
      episodesOpened,
      episodesStillOpen,
      unattributed,
      failed,
      nextOffset:
        positions.length < input.detectLimit ? 0 : input.detectOffset + positions.length,
    };
  }

  /**
   * The close half, driven from the EPISODES rather than from the positions.
   *
   * It has to be: a recovered position simply stops matching the shortfall
   * predicate, so nothing in the detection page ever mentions it again. This is
   * the same inversion `master.product.reconcile` makes for deletions — an
   * enumeration of what is still true cannot reveal what stopped being true.
   */
  private async runClose(
    input: DetectShortfallsInput,
    now: Date
  ): Promise<{
    episodesExamined: number;
    episodesClosed: number;
    failed: number;
    nextOffset: number;
  }> {
    const episodes = await this.shortfalls.listOpenEpisodes(
      input.closeLimit,
      input.closeOffset
    );

    if (episodes.length === 0) {
      return { episodesExamined: 0, episodesClosed: 0, failed: 0, nextOffset: 0 };
    }

    // Scoped to THIS page's positions. Reading the whole shortfall set here
    // would defeat the close budget: the page stays capped while the query
    // grows without limit.
    const positionIds = [...new Set(episodes.map((episode) => episode.inventoryItemId))];
    const shortPositionIds = await this.shortfalls.listShortPositionIds(positionIds);

    const held = await this.shortfalls.listHeldForPositions(
      positionIds
    );
    const holdKeys = new Set(
      held.map((reservation) => this.holdKey(reservation.orderRecordId, reservation.inventoryItemId))
    );

    let episodesClosed = 0;
    let failed = 0;

    for (const episode of episodes) {
      const stillShort = shortPositionIds.has(episode.inventoryItemId);
      const stillHeld = holdKeys.has(
        this.holdKey(episode.orderRecordId, episode.inventoryItemId)
      );

      // Order matters. A cancelled order's reservation is `released`, so it
      // leaves the `held` set the instant the cancellation lands — while the
      // position may well still be short for OTHER orders. Testing the hold
      // first is what makes cancellation a real second close trigger rather
      // than something that only takes effect once the master happens to
      // recover.
      const reason = !stillHeld ? 'reservation-closed' : !stillShort ? 'recovered' : null;
      if (reason === null) {
        continue;
      }

      try {
        const closed = await this.shortfalls.closeEpisode(episode.id, reason, now);
        if (closed) {
          episodesClosed += 1;
        }
      } catch (error) {
        failed += 1;
        this.logger.error(
          `reservation_shortfall_close_failed episode=${episode.id} ` +
            `order=${episode.orderRecordId} position=${episode.inventoryItemId}`,
          (error as Error).stack
        );
      }
    }

    return {
      episodesExamined: episodes.length,
      episodesClosed,
      failed,
      // Advances by rows READ, and wraps on a short page. Skipping is harmless
      // here in a way it is not in an ordinary self-consuming sweep: an episode
      // this page did not visit stays OPEN and is therefore still in the set on
      // the next tick.
      nextOffset: episodes.length < input.closeLimit ? 0 : input.closeOffset + episodes.length,
    };
  }

  /**
   * Youngest-first attribution — a STATED POLICY, not an inference.
   *
   * "The last promise made is the one at risk" is a rule OpenLinker chose.
   * Nothing in the ledger says which order the missing units were going to, so
   * any rule here is a choice; this one is stable, explicable to an operator,
   * and matches the intuition that the newest order is the least committed.
   *
   * Two lines of one order on one position collapse into a single attribution,
   * because the episode grain is the ORDER, not the line.
   */
  private attribute(
    positionShortfall: number,
    heldYoungestFirst: readonly Reservation[]
  ): readonly ShortfallAttribution[] {
    let remaining = positionShortfall;
    const byOrder = new Map<string, number>();

    for (const reservation of heldYoungestFirst) {
      if (remaining <= 0) {
        break;
      }
      const share = Math.min(remaining, reservation.quantity);
      byOrder.set(
        reservation.orderRecordId,
        (byOrder.get(reservation.orderRecordId) ?? 0) + share
      );
      remaining -= share;
    }

    return [...byOrder.entries()].map(([orderRecordId, shortQuantity]) => ({
      orderRecordId,
      shortQuantity,
    }));
  }

  /**
   * The sku snapshot, resolved through the products context.
   *
   * NEVER a SQL join onto `product_variants`: that table belongs to another
   * context, and ADR-036 admits a raw-table cross-context join only for a
   * filter/sort/pagination need — which a display column is not. Batched across
   * the whole page, and a failure degrades to no sku rather than losing the
   * episode: an episode naming an order and a variant is still worth recording.
   */
  private async resolveSkus(
    positions: readonly ShortfallPositionRow[]
  ): Promise<Map<string, string>> {
    const skuByVariantId = new Map<string, string>();
    const productIds = [...new Set(positions.map((position) => position.productId))];
    if (productIds.length === 0) {
      return skuByVariantId;
    }

    try {
      const variants = await this.products.getVariantsByProductIds(productIds);
      for (const variant of variants) {
        if (variant.sku !== null && variant.sku !== undefined) {
          skuByVariantId.set(variant.id, variant.sku);
        }
      }
    } catch (error) {
      this.logger.warn(
        `reservation_shortfall_sku_lookup_failed products=${String(productIds.length)} — ` +
          `episodes will be recorded without a sku; the order and variant are still named. ` +
          `${(error as Error).message}`
      );
    }

    return skuByVariantId;
  }

  private groupByPosition(
    reservations: readonly Reservation[]
  ): Map<string, Reservation[]> {
    const grouped = new Map<string, Reservation[]>();
    for (const reservation of reservations) {
      const bucket = grouped.get(reservation.inventoryItemId);
      if (bucket === undefined) {
        grouped.set(reservation.inventoryItemId, [reservation]);
      } else {
        bucket.push(reservation);
      }
    }
    return grouped;
  }

  private holdKey(orderRecordId: string, inventoryItemId: string): string {
    return `${orderRecordId}::${inventoryItemId}`;
  }

  /**
   * The counter-versus-ledger disagreement signal.
   *
   * `olReservedQuantity` is denormalised over the ledger and the ledger is
   * authoritative, so a shortfall with no `held` row behind it means the two
   * have drifted. There is no order to name, so no episode is written — but a
   * non-recording exit that logged nothing would be exactly the silent decline
   * this issue exists to remove.
   */
  private warnUnattributable(
    position: ShortfallPositionRow,
    positionShortfall: number,
    residue: number
  ): void {
    this.logger.error(
      `reservation_shortfall_unattributable position=${position.inventoryItemId} ` +
        `variant=${position.productVariantId ?? 'none'} ` +
        `available=${String(position.availableQuantity)} ` +
        `olReserved=${String(position.olReservedQuantity)} ` +
        `shortfall=${String(positionShortfall)} unattributed=${String(residue)} — ` +
        `the position counter promises more than the reservation ledger accounts ` +
        `for, so these units name no order and no episode was opened. The ledger ` +
        `is authoritative; investigate the drift.`
    );
  }
}
