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
import { SYNC_PROGRESS_COPY } from './sync-progress.copy';
import type { SyncGuideItemId } from './sync-guide.copy';

export interface CursorDescription {
  label: string;
  /** Expected minutes between moves; null when the cursor has no schedule of its own. */
  cadenceMinutes: number | null;
  guideId: SyncGuideItemId | null;
  /** Platform that may legitimately write the key (#3991 misplaced-key check). */
  platform: string | null;
  /** Job + payload for Run now; null when there is no safe manual run. */
  runNow: { jobType: string; payload: Record<string, unknown> } | null;
}

interface Row {
  match: RegExp;
  label: string;
  cadence: number | null;
  guideId: SyncGuideItemId | null;
  /** Where the key says which platform owns it. */
  platformFromKey?: boolean;
  runNow?: (key: string) => CursorDescription['runNow'];
}

const L = SYNC_PROGRESS_COPY.labels;
const feed = (jobType: string) => (key: string): CursorDescription['runNow'] => ({
  jobType,
  payload: { schemaVersion: 1, cursorKey: key, limit: 100 },
});
const sweep = (jobType: string) => (): CursorDescription['runNow'] => ({ jobType, payload: { schemaVersion: 1 } });

const ROWS: readonly Row[] = [
  { match: /^[a-z]+\.orders\.(lastEventId|inboxCursor)$/, label: L.newOrders, cadence: 5, guideId: 's-orders', platformFromKey: true, runNow: feed('marketplace.orders.poll') },
  { match: /^[a-z]+\.orders\.dateUpd$/, label: L.changedOrders, cadence: 10, guideId: 's-changed-orders', platformFromKey: true, runNow: feed('marketplace.orders.poll') },
  { match: /^[a-z]+\.orders\.[A-Za-z]+Cursor$/, label: L.newOrders, cadence: 10, guideId: 's-orders', platformFromKey: true, runNow: feed('marketplace.orders.poll') },
  { match: /^allegro\.offers\.lastEventId$/, label: L.offerChanges, cadence: 15, guideId: 's-offer-changes', platformFromKey: true, runNow: feed('marketplace.offers.sync') },
  { match: /^allegro\.customerReturns\.lastReturnId$/, label: L.newReturns, cadence: 30, guideId: 's-returns', platformFromKey: true, runNow: feed('marketplace.returns.poll') },
  { match: /^allegro\.customerReturns\.scanOffset$/, label: L.openReturnsCheck, cadence: 60, guideId: 's-returns-check', platformFromKey: true, runNow: feed('marketplace.returns.statusSync') },
  { match: /\.offerStatus\.scanOffset$/, label: L.listingStatus, cadence: 60, guideId: 's-listing-status', platformFromKey: true, runNow: feed('marketplace.offer.statusSync') },
  { match: /\.shipmentStatus\.scanOffset$/, label: L.parcelTracking, cadence: 15, guideId: 's-parcel', platformFromKey: true, runNow: feed('marketplace.shipment.statusSync') },
  { match: /^prestashop\.fulfillmentStatus\.scanOffset$/, label: L.shopOrderStatus, cadence: 30, guideId: 's-shop-status', platformFromKey: true, runNow: feed('marketplace.fulfillment.statusSync') },
  { match: /^sourceFulfillmentStatus\.scanOffset$/, label: L.channelOrderStatus, cadence: 30, guideId: 's-shop-status' },
  { match: /^shop\.productStatus\.scanOffset$/, label: L.shopProductStatus, cadence: 60, guideId: 's-listing-status' },
  { match: /^master\.product\.sweep:/, label: L.productCatalogue, cadence: 20, guideId: 's-catalogue', runNow: sweep('master.product.syncAll') },
  { match: /^master\.inventory\.sweep:/, label: L.stockLevels, cadence: 15, guideId: 's-stock', runNow: sweep('master.inventory.syncAll') },
  { match: /^master\.product-reconcile\.sweep:/, label: L.deletedProducts, cadence: 60, guideId: 's-deleted', runNow: sweep('master.product.reconcile') },
  { match: /^master\.product-delta\.sweep:/, label: L.changedProducts, cadence: 20, guideId: 's-catalogue' },
  { match: /^returns\.orphanReattribution\.scanOffset$/, label: L.orphanReturns, cadence: 30, guideId: 's-system' },
  { match: /^automation\.deadlineSweep\.scanOffset$/, label: L.automationDeadlines, cadence: 15, guideId: 's-system' },
  { match: /^inventory\.reservationShortfall\.detectOffset$/, label: L.shortfallDetect, cadence: 15, guideId: 's-system' },
  { match: /^inventory\.reservationShortfall\.closeOffset$/, label: L.shortfallClose, cadence: 15, guideId: 's-system' },
  { match: /^inventory\.offerQuantity\.observedAt:offer:/, label: L.stockWriteOrder, cadence: null, guideId: 'p-stock' },
];

export function describeCursor(cursorKey: string): CursorDescription {
  const row = ROWS.find((r) => r.match.test(cursorKey));
  if (!row) {
    return { label: L.unrecognised, cadenceMinutes: null, guideId: 'q-unknown', platform: null, runNow: null };
  }
  return {
    label: row.label,
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
