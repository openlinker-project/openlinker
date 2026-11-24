/**
 * Order Health Fixtures (#3482)
 *
 * **One table, consumed by both halves of a rule written twice.** The `synced`
 * side of the health partition exists as TypeScript in the frontend
 * (`deriveOrderHealth`) and as SQL in `OrderRecordRepository.IS_SYNCED_HEALTH`.
 * They are written in different languages over different shapes, so no textual
 * guard can prove they agree about meaning - and the "change both" comment that
 * tied them let one of them read a NULL `fulfillmentState` wrong: an order on the
 * pack bench (no shipment yet) counted in NO bucket in SQL while the row showed
 * `awaiting_dispatch`.
 *
 * What proves agreement is this table: the integration spec seeds every row and
 * asserts the SQL puts it in `expected`, and the frontend unit test runs the
 * FE mirror of the same table through `deriveOrderHealth`. The mirror script
 * (`check-handled-in-openlinker-mirror.mjs`) holds the two tables to the same
 * row names and expectations, so a case added on one side only fails the build.
 *
 * `fulfillmentState: null` is the load-bearing row. It is the state of every
 * order that has not shipped, and every earlier fixture seeded `'not-shipped'`.
 *
 * Lives on the `@openlinker/core/orders/testing` subpath, not the production
 * barrel: the int-spec in `apps/api` must consume the IDENTICAL table, but the
 * API layer must not be one autocomplete away from importing test data.
 *
 * @module libs/core/src/orders/testing
 */

export type OrderHealthFixtureBucket =
  | 'source_deleted'
  | 'awaiting_mapping'
  | 'needs_attention'
  | 'synced'
  | 'awaiting_dispatch';

export interface OrderHealthFixture {
  /** What the row demonstrates, in the operator's terms. Unique; the mirror guard keys on it. */
  readonly name: string;
  readonly recordStatus: 'ready' | 'awaiting_mapping' | 'source_deleted';
  /** The statuses of the order's destination rows, in order. */
  readonly syncStatuses: readonly ('pending' | 'syncing' | 'synced' | 'failed')[];
  /** `null` until the first shipment mutation - NOT the same as `'not-shipped'`. */
  readonly fulfillmentState: string | null;
  /** A live pack-bench `fulfillment_works` row exists for the order. */
  readonly liveWork: boolean;
  readonly expected: OrderHealthFixtureBucket;
}

export const ORDER_HEALTH_FIXTURES: readonly OrderHealthFixture[] = [
  // --- the destination-driven buckets, unchanged by #3482 -------------------
  {
    name: 'a deleted source order',
    recordStatus: 'source_deleted',
    syncStatuses: [],
    fulfillmentState: null,
    liveWork: false,
    expected: 'source_deleted',
  },
  {
    name: 'an order waiting for a catalogue mapping',
    recordStatus: 'awaiting_mapping',
    syncStatuses: [],
    fulfillmentState: null,
    liveWork: false,
    expected: 'awaiting_mapping',
  },
  {
    name: 'a destination failed',
    recordStatus: 'ready',
    syncStatuses: ['failed'],
    fulfillmentState: null,
    liveWork: false,
    expected: 'needs_attention',
  },
  {
    name: 'a failed destination beside a synced one',
    recordStatus: 'ready',
    syncStatuses: ['failed', 'synced'],
    fulfillmentState: null,
    liveWork: false,
    expected: 'needs_attention',
  },
  {
    name: 'a destination synced',
    recordStatus: 'ready',
    syncStatuses: ['synced'],
    fulfillmentState: null,
    liveWork: false,
    expected: 'synced',
  },
  {
    name: 'destinations only pending',
    recordStatus: 'ready',
    syncStatuses: ['pending'],
    fulfillmentState: null,
    liveWork: false,
    expected: 'awaiting_dispatch',
  },
  {
    name: 'no destination and nothing shipped',
    recordStatus: 'ready',
    syncStatuses: [],
    fulfillmentState: null,
    liveWork: false,
    expected: 'awaiting_dispatch',
  },

  // --- an order OpenLinker handles itself (#3482) ---------------------------
  {
    // The regression this table exists for: `fulfillmentState` is NULL until the
    // first shipment mutation, so a bare `IN (...)` made this order count nowhere.
    name: 'on the pack bench with no shipment yet (fulfillmentState NULL)',
    recordStatus: 'ready',
    syncStatuses: [],
    fulfillmentState: null,
    liveWork: true,
    expected: 'awaiting_dispatch',
  },
  {
    name: 'on the pack bench, shipment state not-shipped',
    recordStatus: 'ready',
    syncStatuses: [],
    fulfillmentState: 'not-shipped',
    liveWork: true,
    expected: 'awaiting_dispatch',
  },
  {
    name: 'handled and dispatched',
    recordStatus: 'ready',
    syncStatuses: [],
    fulfillmentState: 'dispatched',
    liveWork: true,
    expected: 'synced',
  },
  {
    name: 'handled and delivered',
    recordStatus: 'ready',
    syncStatuses: [],
    fulfillmentState: 'delivered',
    liveWork: true,
    expected: 'synced',
  },
  {
    // The handled condition is what keeps an unrouted order a marketplace shipped
    // in its old bucket.
    name: 'shipped by a marketplace with no work of ours',
    recordStatus: 'ready',
    syncStatuses: [],
    fulfillmentState: 'delivered',
    liveWork: false,
    expected: 'awaiting_dispatch',
  },
  {
    name: 'handled and dispatched, but a destination failed',
    recordStatus: 'ready',
    syncStatuses: ['failed'],
    fulfillmentState: 'dispatched',
    liveWork: true,
    expected: 'needs_attention',
  },
];
