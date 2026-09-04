/**
 * Pack-bench API client (#2416, `W3b-3`)
 *
 * Two calls: read the bench's work, and move one parcel to the front of the
 * queue or back into deadline order.
 *
 * ## The expedite goes through the SHARED fulfilment action route
 *
 * `POST /fulfillment/works/:workId/actions/:action` is the one guarded action
 * endpoint (#2406), and its `:action` is validated against the same constant
 * the read model filters `supportedActions` with. Minting a bench-specific
 * write would have been a second door onto the same aggregate carrying its own
 * copy of the optimistic-token handling — the #1487 choke-point rule, one level
 * out. It also means the bench cannot offer a control the server would reject.
 *
 * @module apps/web/src/features/bench/api
 */
import { parseBenchWorkList } from './bench-work.schema';
import type { BenchWorkList } from './bench-work.types';

export interface BenchApi {
  /**
   * Everything routed to this bench's packing connection and accepted there.
   *
   * Takes no arguments: the scope is a property of the bench rather than of the
   * request, and the server decides it. The search field filters rows the
   * browser already holds.
   */
  listWork: () => Promise<BenchWorkList>;
  /**
   * Move one parcel ahead of deadline order, or put it back.
   *
   * `action` is whichever of the pair the server offered in `supportedActions`
   * — the direction is never decided here. `expectedVersion` is the optimistic
   * token read with the row; a stale one answers 409.
   */
  setExpedited: (workId: string, action: string, expectedVersion: number) => Promise<void>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

export function createBenchApi(request: ApiRequest): BenchApi {
  return {
    async listWork(): Promise<BenchWorkList> {
      return parseBenchWorkList(await request<unknown>('/bench/work'));
    },
    async setExpedited(workId, action, expectedVersion): Promise<void> {
      await request<unknown>(
        `/fulfillment/works/${encodeURIComponent(workId)}/actions/${encodeURIComponent(action)}`,
        { method: 'POST', body: JSON.stringify({ expectedVersion }) }
      );
    },
  };
}
