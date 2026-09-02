/**
 * Fulfilment-task API client (#2411, list axis added by #2410)
 *
 * Thin typed access to the #2406 worklist read model. Every response is parsed
 * through the boundary schema so a shape change surfaces here rather than as an
 * `undefined` three components deep.
 *
 * ## `listByOrder` is `list` with one filter, not a second endpoint
 *
 * #2410's worklist needs the same `GET /fulfillment/works` with `locationId`
 * and paging, so the query string is built once here and `listByOrder` is
 * expressed through it. Two builders for one endpoint is how the order-scoped
 * read and the worklist would come to encode a param differently — and the
 * emitted URL is pinned by a test for exactly that reason.
 *
 * ## Only DEFINED params are emitted
 *
 * `URLSearchParams` stringifies `undefined` to the literal `"undefined"`, which
 * the DTO would then try to validate. An absent filter must be an absent param.
 *
 * @module apps/web/src/features/fulfillment/api
 */
import { parseFulfillmentTask, parseFulfillmentTaskPage } from './fulfillment.schema';
import type {
  ApplyFulfillmentTaskActionRequest,
  FulfillmentTask,
  FulfillmentTaskFilters,
  FulfillmentTaskPage,
} from './fulfillment.types';

export interface FulfillmentApi {
  /**
   * One filtered, paged page of fulfilment tasks.
   *
   * `status` / `requestStatus` are accepted by the endpoint and deliberately
   * NOT exposed here: they are closed unions this app may not mirror (see the
   * `fulfillment.types.ts` docblock), so there is nothing safe to send.
   */
  list: (filters?: FulfillmentTaskFilters) => Promise<FulfillmentTaskPage>;
  /** Every fulfilment task covering one order. */
  listByOrder: (orderId: string) => Promise<FulfillmentTaskPage>;
  /** One fulfilment task by id. */
  get: (workId: string) => Promise<FulfillmentTask>;
  /**
   * Apply one action. `expectedVersion` is required by the contract; a stale
   * token answers 409 `version_conflict` (retryable), an illegal action answers
   * 409 `action_not_legal` (not retryable).
   */
  applyAction: (
    workId: string,
    action: string,
    body: ApplyFulfillmentTaskActionRequest
  ) => Promise<FulfillmentTask>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

/** `/fulfillment/works` plus only the params that are actually set. */
export function buildFulfillmentWorksPath(filters: FulfillmentTaskFilters = {}): string {
  const params = new URLSearchParams();
  if (filters.orderId !== undefined) params.set('orderId', filters.orderId);
  if (filters.locationId !== undefined) params.set('locationId', filters.locationId);
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters.offset !== undefined) params.set('offset', String(filters.offset));
  const query = params.toString();
  return query.length > 0 ? `/fulfillment/works?${query}` : '/fulfillment/works';
}

export function createFulfillmentApi(request: ApiRequest): FulfillmentApi {
  async function list(filters: FulfillmentTaskFilters = {}): Promise<FulfillmentTaskPage> {
    const payload = await request<unknown>(buildFulfillmentWorksPath(filters));
    return parseFulfillmentTaskPage(payload);
  }

  return {
    list,
    async listByOrder(orderId): Promise<FulfillmentTaskPage> {
      return list({ orderId });
    },
    async get(workId): Promise<FulfillmentTask> {
      const payload = await request<unknown>(
        `/fulfillment/works/${encodeURIComponent(workId)}`
      );
      return parseFulfillmentTask(payload);
    },
    async applyAction(workId, action, body): Promise<FulfillmentTask> {
      const payload = await request<unknown>(
        `/fulfillment/works/${encodeURIComponent(workId)}/actions/${encodeURIComponent(action)}`,
        { method: 'POST', body: JSON.stringify(body) }
      );
      return parseFulfillmentTask(payload);
    },
  };
}
