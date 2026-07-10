/**
 * Order-arrival helper
 *
 * After the attended buyer purchase, the new order lands in OL asynchronously
 * (webhook or poll). `waitForOrder` polls the Orders list until a *new* `ready`
 * order appears — one whose id was not present before the pause — so the flow
 * gates on the real order rather than a fixed sleep or a stale record.
 *
 * @module support
 */
import type { ApiClient } from '../api/api-client';
import type { OrderRecord } from '../api/api.types';
import { pollUntil } from './poller';

export interface WaitForOrderOptions {
  /** Restrict to a marketplace source connection. */
  sourceConnectionId?: string;
  /** Order ids already seen before the purchase — a new one must differ. */
  knownOrderIds?: ReadonlySet<string>;
  /** How long to wait for the buyer + ingestion (default 15 min). */
  timeoutMs?: number;
  /** Poll interval (default 5s — the buyer is a human). */
  intervalMs?: number;
}

/** Capture the current set of order ids, to detect a *new* one later. */
export async function snapshotOrderIds(
  api: ApiClient,
  sourceConnectionId?: string,
): Promise<Set<string>> {
  const page = await api.orders.list({ sourceConnectionId, limit: 100 });
  return new Set(page.items.map((o) => o.internalOrderId));
}

/** Poll until a new `ready` order appears; return it. */
export async function waitForOrder(
  api: ApiClient,
  options: WaitForOrderOptions = {},
): Promise<OrderRecord> {
  const known = options.knownOrderIds ?? new Set<string>();
  const found = await pollUntil<OrderRecord | undefined>(
    async () => {
      const page = await api.orders.list({
        sourceConnectionId: options.sourceConnectionId,
        limit: 100,
      });
      return page.items.find(
        (o) => o.recordStatus === 'ready' && !known.has(o.internalOrderId),
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
