/**
 * Fulfilment-task API client (#2411)
 *
 * Thin typed access to the #2406 worklist read model. Every response is parsed
 * through the boundary schema so a shape change surfaces here rather than as an
 * `undefined` three components deep.
 *
 * @module apps/web/src/features/fulfillment/api
 */
import { parseFulfillmentTask, parseFulfillmentTaskPage } from './fulfillment.schema';
import type {
  ApplyFulfillmentTaskActionRequest,
  FulfillmentTask,
  FulfillmentTaskPage,
} from './fulfillment.types';

export interface FulfillmentApi {
  /** Every fulfilment task covering one order. */
  listByOrder: (orderId: string) => Promise<FulfillmentTaskPage>;
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

export function createFulfillmentApi(request: ApiRequest): FulfillmentApi {
  return {
    async listByOrder(orderId): Promise<FulfillmentTaskPage> {
      const payload = await request<unknown>(
        `/fulfillment/works?orderId=${encodeURIComponent(orderId)}`
      );
      return parseFulfillmentTaskPage(payload);
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
