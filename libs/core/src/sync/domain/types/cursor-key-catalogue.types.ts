/**
 * Cursor Key Catalogue (#4023)
 *
 * What a `connection_cursors` key IS: which family of bookmark it belongs to,
 * which job type advances it, and whether an operator may move it back. Read by
 * the cursor overview (to pair a cursor with its last run) and by the rewind
 * service (to refuse every key it does not know how to move safely).
 *
 * Pure-rule exception (`docs/engineering-standards.md`): this function IS the
 * rule for the `CursorFamily` union it sits with. Adding a cursor key that an
 * operator should see paired with its run means adding a row here.
 *
 * A date rewind of an order feed is deliberately NOT offered. A feed cursor is
 * the adapter's own opaque format (PrestaShop writes `YYYY-MM-DD HH:MM:SS|id`
 * in shop-local time, #2605), so writing one from core would put platform
 * knowledge in core and reopen the timezone defect #2605 fixed.
 *
 * @module libs/core/src/sync/domain/types
 */
import type { JobType } from './sync-job.types';

export const CursorFamilyValues = [
  'event-bookmark',
  'rolling-offset',
  'sweep-cycle',
  'completion-stamp',
  'write-order',
] as const;
export type CursorFamily = (typeof CursorFamilyValues)[number];

/** `restart-pass` clears an open catalogue pass; `restart-check` puts a rolling re-check back at item 0. */
export const CursorRewindTargetValues = ['restart-pass', 'restart-check'] as const;
export type CursorRewindTarget = (typeof CursorRewindTargetValues)[number];

export interface CursorCatalogueEntry {
  family: CursorFamily;
  /** The job type whose runs advance this cursor; null when no single job owns it. */
  writerJobType: JobType | null;
  rewind: CursorRewindTarget | null;
}

/**
 * Per-listing stock write marks, one row per mapped offer (#2617). The same
 * literal `offerQuantityObservationCursorKey` builds in the inventory context;
 * `cursor-key-catalogue.types.spec.ts` pins the two together.
 */
export const OFFER_QUANTITY_WRITE_MARK_PREFIX = 'inventory.offerQuantity.observedAt:offer:';

interface CatalogueRow extends CursorCatalogueEntry {
  match: RegExp;
}

const ROWS: readonly CatalogueRow[] = [
  { match: /^[a-z]+\.orders\.(lastEventId|inboxCursor|dateUpd|[A-Za-z]+Cursor)$/, family: 'event-bookmark', writerJobType: 'marketplace.orders.poll', rewind: null },
  { match: /^allegro\.offers\.lastEventId$/, family: 'event-bookmark', writerJobType: 'marketplace.offers.sync', rewind: null },
  { match: /^allegro\.customerReturns\.lastReturnId$/, family: 'event-bookmark', writerJobType: 'marketplace.returns.poll', rewind: null },
  { match: /^allegro\.customerReturns\.scanOffset$/, family: 'rolling-offset', writerJobType: 'marketplace.returns.statusSync', rewind: 'restart-check' },
  { match: /\.offerStatus\.scanOffset$/, family: 'rolling-offset', writerJobType: 'marketplace.offer.statusSync', rewind: 'restart-check' },
  { match: /\.shipmentStatus\.scanOffset$/, family: 'rolling-offset', writerJobType: 'marketplace.shipment.statusSync', rewind: 'restart-check' },
  { match: /^[a-z]+\.fulfillmentStatus\.scanOffset$/, family: 'rolling-offset', writerJobType: 'marketplace.fulfillment.statusSync', rewind: 'restart-check' },
  { match: /^destination\.taxonomy\.frontier/, family: 'event-bookmark', writerJobType: 'destination.taxonomy.sync', rewind: null },
  { match: /^fulfillment\.unsubmitted\.after$/, family: 'event-bookmark', writerJobType: 'fulfillment.work.timeoutSweep', rewind: null },
  { match: /^fulfillment\.reroute\.after$/, family: 'event-bookmark', writerJobType: 'fulfillment.work.rerouteSweep', rewind: null },
  { match: /^sourceFulfillmentStatus\.scanOffset$/, family: 'rolling-offset', writerJobType: 'marketplace.sourceFulfillment.statusSync', rewind: 'restart-check' },
  { match: /^shop\.productStatus\.scanOffset$/, family: 'rolling-offset', writerJobType: 'shop.product.statusSync', rewind: 'restart-check' },
  { match: /^returns\.orphanReattribution\.scanOffset$/, family: 'rolling-offset', writerJobType: 'returns.orphan.reconcile', rewind: 'restart-check' },
  { match: /^automation\.deadlineSweep\.scanOffset$/, family: 'rolling-offset', writerJobType: 'automation.trigger.deadlineSweep', rewind: 'restart-check' },
  { match: /^inventory\.reservationShortfall\.(detect|close)Offset$/, family: 'rolling-offset', writerJobType: 'inventory.reservations.shortfall', rewind: 'restart-check' },
  { match: /^master\.product\.sweep:connection:/, family: 'sweep-cycle', writerJobType: 'master.product.syncAll', rewind: 'restart-pass' },
  { match: /^master\.inventory\.sweep:connection:/, family: 'sweep-cycle', writerJobType: 'master.inventory.syncAll', rewind: 'restart-pass' },
  { match: /^master\.product-reconcile\.sweep:connection:/, family: 'sweep-cycle', writerJobType: 'master.product.reconcile', rewind: 'restart-pass' },
  { match: /^master\.product-delta\.sweep:connection:/, family: 'sweep-cycle', writerJobType: 'master.product.syncDelta', rewind: 'restart-pass' },
  { match: /^master\.[a-z-]+\.(completedAt|remainingNull):connection:/, family: 'completion-stamp', writerJobType: null, rewind: null },
  { match: /^inventory\.offerQuantity\.observedAt:offer:/, family: 'write-order', writerJobType: null, rewind: null },
];

/** The catalogue entry for a key, or null for a key this build does not recognise. */
export function resolveCursorCatalogueEntry(cursorKey: string): CursorCatalogueEntry | null {
  const row = ROWS.find((r) => r.match.test(cursorKey));
  if (!row) return null;
  return { family: row.family, writerJobType: row.writerJobType, rewind: row.rewind };
}

/** Every job type the catalogue pairs a cursor with, for one batched job read. */
export function catalogueWriterJobTypes(): JobType[] {
  return [...new Set(ROWS.map((r) => r.writerJobType).filter((t): t is JobType => t !== null))];
}
