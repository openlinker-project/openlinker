/**
 * Cursor Catalogue (frontend) (#4024)
 *
 * What the page says about a cursor key: its operator label, its expected
 * cadence, which guide entry explains it, which platform owns it, and how to
 * run it now. The backend catalogue (#4023) owns the family, the writer job
 * and the rewind target; this file only adds what the operator reads.
 *
 * Cadences are the shipped default crons. A deployment that changes a cron
 * changes when a sync is "late"; the guide states the threshold it uses.
 *
 * @module apps/web/src/features/cursors/lib
 */
import type { SyncProgressCopy } from './sync-progress-copy';

export type CursorLabelKey = keyof SyncProgressCopy['labels'];

export interface CursorDescription {
  labelKey: CursorLabelKey;
  /** Expected minutes between moves; null when the cursor has no schedule of its own. */
  cadenceMinutes: number | null;
  guideId: string | null;
  /** Platform that may legitimately write the key (#3991 misplaced-key check). */
  platform: string | null;
  /** Job + payload for Run now; null when there is no safe manual run. */
  runNow: { jobType: string; payload: Record<string, unknown> } | null;
}

interface Row {
  match: RegExp;
  labelKey: CursorLabelKey;
  cadence: number | null;
  guideId: string | null;
  /**
   * The key's first segment names the platform whose feed it reads. Only true
   * for order / offer / return FEEDS: the re-check keys are handler defaults
   * every connection uses (`allegro.shipmentStatus.scanOffset` on an InPost
   * connection is normal), so they say nothing about ownership.
   */
  platformFromKey?: boolean;
  runNow?: (key: string) => CursorDescription['runNow'];
}

const feed =
  (jobType: string) =>
  (key: string): CursorDescription['runNow'] => ({
    jobType,
    payload: { schemaVersion: 1, cursorKey: key, limit: 100 },
  });
const sweep = (jobType: string) => (): CursorDescription['runNow'] => ({
  jobType,
  payload: { schemaVersion: 1 },
});

const ROWS: readonly Row[] = [
  {
    match: /^[a-z]+\.orders\.(lastEventId|inboxCursor)$/,
    labelKey: 'newOrders',
    cadence: 5,
    guideId: 's-orders',
    platformFromKey: true,
    runNow: feed('marketplace.orders.poll'),
  },
  {
    match: /^[a-z]+\.orders\.dateUpd$/,
    labelKey: 'changedOrders',
    cadence: 10,
    guideId: 's-changed-orders',
    platformFromKey: true,
    runNow: feed('marketplace.orders.poll'),
  },
  {
    match: /^[a-z]+\.orders\.[A-Za-z]+Cursor$/,
    labelKey: 'newOrders',
    cadence: 10,
    guideId: 's-orders',
    platformFromKey: true,
    runNow: feed('marketplace.orders.poll'),
  },
  {
    match: /^allegro\.offers\.lastEventId$/,
    labelKey: 'offerChanges',
    cadence: 15,
    guideId: 's-offer-changes',
    platformFromKey: true,
    runNow: feed('marketplace.offers.sync'),
  },
  {
    match: /^allegro\.customerReturns\.lastReturnId$/,
    labelKey: 'newReturns',
    cadence: 30,
    guideId: 's-returns',
    platformFromKey: true,
    runNow: feed('marketplace.returns.poll'),
  },
  {
    match: /^allegro\.customerReturns\.scanOffset$/,
    labelKey: 'openReturnsCheck',
    cadence: 60,
    guideId: 's-returns-check',
    runNow: feed('marketplace.returns.statusSync'),
  },
  {
    match: /\.offerStatus\.scanOffset$/,
    labelKey: 'listingStatus',
    cadence: 60,
    guideId: 's-listing-status',
    runNow: feed('marketplace.offer.statusSync'),
  },
  {
    match: /\.shipmentStatus\.scanOffset$/,
    labelKey: 'parcelTracking',
    cadence: 15,
    guideId: 's-parcel',
    runNow: feed('marketplace.shipment.statusSync'),
  },
  {
    match: /^[a-z]+\.fulfillmentStatus\.scanOffset$/,
    labelKey: 'shopOrderStatus',
    cadence: 30,
    guideId: 's-shop-status',
    runNow: feed('marketplace.fulfillment.statusSync'),
  },
  {
    match: /^destination\.taxonomy\.frontier/,
    labelKey: 'categoryTree',
    cadence: null,
    guideId: 's-categories',
  },
  {
    match: /^fulfillment\.unsubmitted\.after$/,
    labelKey: 'unsentTasks',
    cadence: 60,
    guideId: 's-system',
  },
  {
    match: /^fulfillment\.reroute\.after$/,
    labelKey: 'rerouteCheck',
    cadence: 60,
    guideId: 's-system',
  },
  {
    match: /^sourceFulfillmentStatus\.scanOffset$/,
    labelKey: 'channelOrderStatus',
    cadence: 30,
    guideId: 's-shop-status',
  },
  {
    match: /^shop\.productStatus\.scanOffset$/,
    labelKey: 'shopProductStatus',
    cadence: 60,
    guideId: 's-listing-status',
  },
  {
    match: /^master\.product\.sweep:/,
    labelKey: 'productCatalogue',
    cadence: 20,
    guideId: 's-catalogue',
    runNow: sweep('master.product.syncAll'),
  },
  {
    match: /^master\.inventory\.sweep:/,
    labelKey: 'stockLevels',
    cadence: 15,
    guideId: 's-stock',
    runNow: sweep('master.inventory.syncAll'),
  },
  {
    match: /^master\.product-reconcile\.sweep:/,
    labelKey: 'deletedProducts',
    cadence: 60,
    guideId: 's-deleted',
    runNow: sweep('master.product.reconcile'),
  },
  {
    match: /^master\.product-delta\.sweep:/,
    labelKey: 'changedProducts',
    cadence: 20,
    guideId: 's-catalogue',
  },
  {
    match: /^returns\.orphanReattribution\.scanOffset$/,
    labelKey: 'orphanReturns',
    cadence: 30,
    guideId: 's-system',
  },
  {
    match: /^automation\.deadlineSweep\.scanOffset$/,
    labelKey: 'automationDeadlines',
    cadence: 15,
    guideId: 's-system',
  },
  {
    match: /^inventory\.reservationShortfall\.detectOffset$/,
    labelKey: 'shortfallDetect',
    cadence: 15,
    guideId: 's-system',
  },
  {
    match: /^inventory\.reservationShortfall\.closeOffset$/,
    labelKey: 'shortfallClose',
    cadence: 15,
    guideId: 's-system',
  },
  {
    match: /^inventory\.offerQuantity\.observedAt:offer:/,
    labelKey: 'stockWriteOrder',
    cadence: null,
    guideId: 'p-stock',
  },
];

export function describeCursor(cursorKey: string): CursorDescription {
  const row = ROWS.find((r) => r.match.test(cursorKey));
  if (!row) {
    return {
      labelKey: 'unrecognised',
      cadenceMinutes: null,
      guideId: 'q-unknown',
      platform: null,
      runNow: null,
    };
  }
  return {
    labelKey: row.labelKey,
    cadenceMinutes: row.cadence,
    guideId: row.guideId,
    platform: row.platformFromKey ? cursorKey.slice(0, cursorKey.indexOf('.')) : null,
    runNow: row.runNow ? row.runNow(cursorKey) : null,
  };
}

/** `master.{kind}.completedAt:connection:{id}` -> the sweep cursor key it stamps. */
export function sweepKeyForCompletionStamp(cursorKey: string): string | null {
  const m = /^master\.([a-z-]+)\.completedAt:connection:(.+)$/.exec(cursorKey);
  return m ? `master.${m[1]}.sweep:connection:${m[2]}` : null;
}

/** The operator label for a cursor key, in the active language. */
export function cursorLabel(cursorKey: string, copy: SyncProgressCopy): string {
  return copy.labels[describeCursor(cursorKey).labelKey];
}
