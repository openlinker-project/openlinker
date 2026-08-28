/**
 * Reservation Shortfall Types (#2349, design § 4.2 story I6)
 *
 * The vocabulary of "OpenLinker promised more than the master now has, and
 * these are the orders it lands on".
 *
 * `reservations` deliberately ships with NO `CHECK ("olReservedQuantity" <=
 * "availableQuantity")` — the migration that created it says so in its own
 * header — precisely so this state is *persistable* rather than a failed sync.
 * These types are what makes it *nameable*.
 *
 * @module libs/core/src/inventory/domain/types
 */

/**
 * Why a shortfall episode ended.
 *
 * Two triggers, and the second is not an edge case. Since #2348 `released` is a
 * reachable terminal reservation status in production, so cancelling the
 * at-risk order — one of the two remediations an operator actually has — closes
 * the episode just as the master recovering does.
 */
export const ReservationShortfallCloseReasonValues = [
  /** The position is no longer short: published holds <= `availableQuantity`. */
  'recovered',
  /**
   * The order holds no `held` reservation on that position any more —
   * cancellation (`released`), dispatch (`consumed`), or expiry (`expired`).
   */
  'reservation-closed',
  /**
   * The position is still short and this order still holds there, but the
   * youngest-first attribution no longer lands ANY of the shortfall on it
   * (#2628 review).
   *
   * A partial recovery is the ordinary cause: shortfall 2 across orders A and
   * B, the master recovers 1, and attribution now names only A. Without this
   * reason B's episode is neither re-attributed nor closed, and the badge keeps
   * asserting a risk that reconciliation no longer supports — asserting RISK
   * from a stale row, the mirror of the "never assert HEALTH from absence" rule
   * the surface is otherwise careful about.
   */
  'no-longer-attributed',
  /**
   * The POSITION was staled by the master (#2628 review, #1689).
   *
   * A staled position leaves the shortfall predicate — every shortfall read
   * filters `isStale = false`, because a position the master no longer reports
   * is the stale-variant pause's business, not an oversell. Absence from that
   * read therefore has two causes, and the close pass must not conflate them:
   * inferring `'recovered'` from it asserts that stock came back for a product
   * that no longer exists, which is the strongest possible form of the "never
   * assert HEALTH from absence" mistake — a false all-clear on the one order
   * that certainly cannot be fulfilled.
   *
   * It is a close rather than a standing episode because the risk this episode
   * describes has been superseded, not resolved: #1689 pauses the variant's
   * offers and the order carries `recordStatus = 'source_deleted'`, which is a
   * louder and more accurate operator signal than a shortfall badge.
   */
  'position-stale',
] as const;

export type ReservationShortfallCloseReason =
  (typeof ReservationShortfallCloseReasonValues)[number];

/** One position observed short, as the detection page reads it. */
export interface ShortfallPositionRow {
  readonly inventoryItemId: string;
  readonly productId: string;
  readonly productVariantId: string | null;
  readonly availableQuantity: number;
  /**
   * Units claimed on this position by `held` holds stamped `published` — NOT
   * `inventory_items.olReservedQuantity` (#2628 review).
   *
   * The counter sums both stamps, and a `diagnostic` hold by definition changes
   * nothing OL promises, so a shortfall computed from the counter would name a
   * real order for a risk that does not exist. On the DEFAULT `omp_fulfilled`
   * topology every hold is `diagnostic` and no shipped closer runs, so the
   * counter grows for the life of the install — the counter-blind predicate
   * opened a permanent, never-clearing "stock at risk" episode on a healthy
   * catalogue.
   *
   * Named for what it is rather than reusing the counter's name, so the two can
   * never be confused at a call site again.
   */
  readonly publishedReservedQuantity: number;
}

/** One order's attributed share of one position's shortfall. */
export interface ShortfallAttribution {
  readonly orderRecordId: string;
  readonly shortQuantity: number;
}

/**
 * The open write's input.
 *
 * `sku` is resolved by the SERVICE through `IProductsService`, never by a SQL
 * join onto `product_variants` — that table belongs to the *products* context,
 * and ADR-036 restricts a raw-table cross-context join to a filter/sort need,
 * which a display column is not.
 */
export interface OpenShortfallEpisodeInput {
  readonly orderRecordId: string;
  readonly inventoryItemId: string;
  readonly productVariantId: string | null;
  readonly sku: string | null;
  /** This order's attributed share. Always > 0. */
  readonly shortQuantity: number;
  /** The whole position's shortfall at open time, for context. */
  readonly positionShortfall: number;
  readonly openedAt: Date;
}

/** One run's report. Every field is an observable an operator can act on. */
export interface DetectShortfallsResult {
  /** Positions read by the detection half. */
  readonly positionsExamined: number;
  /** Episodes actually created (a conflict on a still-open episode is not one). */
  readonly episodesOpened: number;
  /**
   * Open episodes re-observed — i.e. a conflict on the partial unique index.
   *
   * Their quantities are REFRESHED by the conflict arm; only the occurrence id
   * is left untouched (#2628 review). "Still open" names the episode's identity
   * surviving, never the row being unwritten.
   */
  readonly episodesStillOpen: number;
  /** Open episodes examined by the close half. */
  readonly episodesExamined: number;
  /** Episodes closed this run. */
  readonly episodesClosed: number;
  /**
   * Shortfall units this run could NOT attribute to any order — a position
   * short with no (or too few) `held` reservations, i.e. the counter and the
   * ledger disagree. A defect signal, never silent.
   */
  readonly unattributed: number;
  /** Per-candidate write failures. The row keeps its state and is retried. */
  readonly failed: number;
  readonly nextDetectOffset: number;
  readonly nextCloseOffset: number;
}
