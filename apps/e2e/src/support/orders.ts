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
