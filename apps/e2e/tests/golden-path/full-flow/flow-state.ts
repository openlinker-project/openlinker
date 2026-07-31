/**
 * Golden path full-flow: shared segment state
 *
 * The attended S0-S9 flow is one business transaction split across sibling spec
 * files: S0 picks the driver product, S2-S4 list it, the PAUSE step waits for a
 * human to buy it, and S5-S10 assert what that sale did. Each segment therefore
 * reads what the previous ones wrote.
 *
 * That handoff is a module-level singleton rather than a Playwright fixture on
 * purpose. A worker-scoped fixture would be recreated whenever Playwright
 * discards a worker, and a test-scoped one obviously cannot span tests; a module
 * singleton lives for the worker *process*, which is exactly the lifetime the
 * flow needs (`workers: 1`, `fullyParallel: false`, so one process runs every
 * segment in file order).
 *
 * The one case where the process does restart is a failed segment — Playwright
 * discards the worker after a failure. That is harmless here only because
 * `segment.ts` writes a durable abort marker in the same breath, so every later
 * segment skips instead of running against a blank `state`. Do not weaken that
 * pairing: without the marker, a fresh worker would silently continue the flow
 * with no product, no baselines and no orders.
 *
 * @module tests/golden-path/full-flow
 */
import type { OrderRecord, Product, ProductVariant } from '../../../src/api/api.types';
import type { OrderIdSnapshot } from '../../../src/support/orders';
import type { StockSnapshot } from '../../../src/support/stock';

export const SOLD_QTY = 1;

/** Mutable state shared across the serial segments. */
export interface FlowState {
  product?: Product;
  primaryVariant?: ProductVariant;
  variantIds: string[];
  olBaseline?: StockSnapshot;
  channelBaseline: Map<string, number>;
  /** One ingested order per purchase platform (keyed by platformType). */
  orders: Map<string, OrderRecord>;
  /** Pre-purchase order snapshot (ids + timestamp) per source connection id. */
  orderSnapshotByConnection: Map<string, OrderIdSnapshot>;
  shipmentIds: Map<string, string>;
  invoiceIds: Map<string, string>;
  /** WooCommerce product id of the published product, captured in S2 for the post-sale re-read. */
  wcProductId?: number;
}

export const state: FlowState = {
  variantIds: [],
  channelBaseline: new Map(),
  orders: new Map(),
  orderSnapshotByConnection: new Map(),
  shipmentIds: new Map(),
  invoiceIds: new Map(),
};
