/**
 * Order-arrival helper
 *
 * After the attended buyer purchase, the new order lands in OL asynchronously
 * (webhook or poll). `waitForOrder` polls the Orders list until a *new* `ready`
 * order appears — one whose id was not in the pre-purchase snapshot AND whose
 * `createdAt` is not older than the snapshot time — so the flow gates on the
 * real order rather than a fixed sleep or a stale record. The time gate matters
 * because the id snapshot is bounded (first 100 orders): on a stack with more
 * than 100 pre-existing orders, order #101 is "unknown" by id alone and would
 * otherwise be returned instantly as the purchase.
 *
 * @module support
 */
import type { ApiClient } from '../api/api-client';
import type { OrderRecord } from '../api/api.types';
import { pollUntil } from './poller';

/** Pre-purchase order snapshot: bounded id set + the moment it was taken. */
export interface OrderIdSnapshot {
  /** Order ids present before the purchase (first 100 — bounded window). */
  ids: ReadonlySet<string>;
  /** When the snapshot was captured; a new order must not predate this. */
  takenAt: Date;
}

/**
 * Allowance for API-server vs test-runner clock skew when comparing an order's
 * `createdAt` against the snapshot time. Generous enough for a demo stack on
 * one machine; small enough that a genuinely stale order (created before the
 * purchase pause, which lasts minutes-to-hours) can never pass.
 */
const CLOCK_SKEW_MS = 2 * 60_000;

export interface WaitForOrderOptions {
  /** Restrict to a marketplace source connection. */
  sourceConnectionId?: string;
  /** Pre-purchase snapshot — a new order must be absent from it AND newer. */
  snapshot?: OrderIdSnapshot;
  /** How long to wait for the buyer + ingestion (default 15 min). */
  timeoutMs?: number;
  /** Poll interval (default 5s — the buyer is a human). */
  intervalMs?: number;
}

/** Capture the current order ids + timestamp, to detect a *new* order later. */
export async function snapshotOrderIds(
  api: ApiClient,
  sourceConnectionId?: string,
): Promise<OrderIdSnapshot> {
  const takenAt = new Date();
  const page = await api.orders.list({ sourceConnectionId, limit: 100 });
  return { ids: new Set(page.items.map((o) => o.internalOrderId)), takenAt };
}

/** Poll until a new `ready` order appears; return it. */
export async function waitForOrder(
  api: ApiClient,
  options: WaitForOrderOptions = {},
): Promise<OrderRecord> {
  const snapshot = options.snapshot;
  const notBeforeMs = snapshot ? snapshot.takenAt.getTime() - CLOCK_SKEW_MS : 0;
  const found = await pollUntil<OrderRecord | undefined>(
    async () => {
      const page = await api.orders.list({
        sourceConnectionId: options.sourceConnectionId,
        limit: 100,
      });
      return page.items.find(
        (o) =>
          o.recordStatus === 'ready' &&
          !(snapshot?.ids.has(o.internalOrderId) ?? false) &&
          new Date(o.createdAt).getTime() >= notBeforeMs,
      );
    },
    (order) => order !== undefined,
    {
      timeoutMs: options.timeoutMs ?? 15 * 60_000,
      intervalMs: options.intervalMs ?? 5_000,
      message: 'a new ready order to appear after the manual purchase',
    },
  );
  return found as OrderRecord;
}

/** Does this OL order record originate from the given source-native order id? */
function matchesExternalOrderId(order: OrderRecord, externalOrderId: string): boolean {
  // Both in-tree order sources shape the feed cursor as `{externalId}:...`
  // (WooCommerce `100:processing:<iso>`, PrestaShop `41:<date_upd>:created`).
  if (order.sourceEventId?.startsWith(`${externalOrderId}:`)) return true;
  const orderNumber = order.orderSnapshot['orderNumber'];
  return (
    (typeof orderNumber === 'string' || typeof orderNumber === 'number') &&
    String(orderNumber) === externalOrderId
  );
}

/**
 * Poll until the OL order ingested from ONE SPECIFIC source-native order id
 * appears.
 *
 * Prefer this over `waitForOrder` whenever the caller created the source order
 * itself. "The next new order" is only unambiguous when nothing else can
 * produce one, and that assumption breaks hardest on a single-store topology:
 * the destination orders OL writes back land in the very same shop, get
 * re-ingested through the source connection, and are indistinguishable from a
 * genuine buyer order — so a scenario asserting on "its" order can silently
 * read OL's own output instead.
 */
export async function waitForOrderByExternalId(
  api: ApiClient,
  options: {
    externalOrderId: string;
    sourceConnectionId?: string;
    timeoutMs?: number;
    intervalMs?: number;
    /**
     * Which `recordStatus` value(s) count as "arrived". Defaults to
     * `['ready']` — every existing caller wants a normally-mapped order. A
     * caller deliberately seeding an unmappable item (e.g. the analytics
     * `product-matching` fixture, #2482) passes `['awaiting_mapping',
     * 'source_deleted']` instead, since such an order never reaches `ready`.
     */
    recordStatuses?: OrderRecord['recordStatus'][];
    /**
     * Re-run the source's ingestion poll before each probe. One up-front
     * trigger is not enough on a loaded stack: the enqueued poll waits behind
     * the scheduler's own backlog, and a cursor-paged feed can need several
     * ticks to reach a just-created order. Failures are swallowed — a poll
     * that cannot be triggered is a slower path to the same answer, not a
     * reason to fail early.
     */
    retriggerPoll?: () => Promise<unknown>;
  },
): Promise<OrderRecord> {
  const acceptedStatuses = new Set(options.recordStatuses ?? ['ready']);
  const found = await pollUntil<OrderRecord | undefined>(
    async () => {
      if (options.retriggerPoll) {
        await options.retriggerPoll().catch(() => undefined);
      }
      const page = await api.orders.list({
        sourceConnectionId: options.sourceConnectionId,
        limit: 100,
      });
      return page.items.find(
        (o) => acceptedStatuses.has(o.recordStatus) && matchesExternalOrderId(o, options.externalOrderId),
      );
    },
    (order) => order !== undefined,
    {
      timeoutMs: options.timeoutMs ?? 120_000,
      intervalMs: options.intervalMs ?? 3_000,
      message: `the OL order ingested from source order ${options.externalOrderId}`,
    },
  );
  return found as OrderRecord;
}
