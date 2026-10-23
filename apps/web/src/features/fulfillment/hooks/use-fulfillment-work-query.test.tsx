/**
 * `useFulfillmentWorkQuery` tests (#3097/#3103)
 *
 * Three properties: the query is disabled — never fired — for an absent id;
 * a 404 reaches the caller as the `ApiError` it was, not `data: null`; and
 * the key sits under the `['fulfillment', ...]` prefix, which is what makes
 * `useFulfillmentTaskActionMutation`'s feature-wide invalidation refresh it.
 *
 * @module apps/web/src/features/fulfillment/hooks
 */
import { waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import { ApiError } from '../../../shared/api/api-error';
import { fulfillmentQueryKeys } from '../api/fulfillment.query-keys';
import type { FulfillmentTask } from '../api/fulfillment.types';
import { useFulfillmentWorkQuery } from './use-fulfillment-work-query';

function task(overrides: Partial<FulfillmentTask> = {}): FulfillmentTask {
  return {
    id: 'ol_work_1',
    orderId: 'ol_order_1',
    locationId: null,
    deliveryMethod: null,
    assignedConnectionId: null,
    assignedToUserId: null,
    selfServeEligible: true,
    status: 'open',
    requestStatus: 'unsubmitted',
    assignmentAttempt: 0,
    cancellationReason: null,
    externalWorkId: null,
    acceptedAt: null,
    cancelledAt: null,
    expeditedAt: null,
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
    lines: [],
    activeHolds: [],
    supportedActions: [],
    version: 1,
    ...overrides,
  };
}

function renderQuery(
  workId: string,
  get: ReturnType<typeof vi.fn>
): { result: () => ReturnType<typeof useFulfillmentWorkQuery> } {
  let latest: ReturnType<typeof useFulfillmentWorkQuery> | undefined;

  function Probe(): null {
    latest = useFulfillmentWorkQuery(workId);
    return null;
  }

  renderWithProviders(<Probe />, {
    apiClient: createMockApiClient({ fulfillment: { get } as never }),
  });

  return {
    result: () => {
      if (latest === undefined) throw new Error('Probe has not rendered yet');
      return latest;
    },
  };
}

describe('useFulfillmentWorkQuery', () => {
  it('never calls the API for an absent id — the query sits disabled', async () => {
    const get = vi.fn();
    const { result } = renderQuery('', get);

    // A disabled query settles pending/idle immediately; give the event loop
    // a turn so a wrongly-enabled query would have had time to fire.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(get).not.toHaveBeenCalled();
    expect(result().isPending).toBe(true);
    expect(result().fetchStatus).toBe('idle');
  });

  it('fetches and returns the task for a real id', async () => {
    const get = vi.fn().mockResolvedValue(task());
    const { result } = renderQuery('ol_work_1', get);

    await waitFor(() => {
      expect(result().data).toEqual(task());
    });

    expect(get).toHaveBeenCalledWith('ol_work_1');
  });

  it('surfaces a 404 as the ApiError it was, never as data: null', async () => {
    const notFound = new ApiError('Not found', 404, undefined);
    const get = vi.fn().mockRejectedValue(notFound);
    const { result } = renderQuery('ol_work_missing', get);

    await waitFor(() => {
      expect(result().isError).toBe(true);
    });

    expect(result().error).toBeInstanceOf(ApiError);
    expect((result().error as ApiError).isNotFound()).toBe(true);
    expect(result().data).toBeUndefined();
  });

  it("does not retry a 404 — the app-wide default excludes it, and this hook adds no override", async () => {
    const notFound = new ApiError('Not found', 404, undefined);
    const get = vi.fn().mockRejectedValue(notFound);
    const { result } = renderQuery('ol_work_missing', get);

    await waitFor(() => {
      expect(result().isError).toBe(true);
    });

    expect(get).toHaveBeenCalledTimes(1);
  });

  it('keys the read under the fulfillment.detail prefix, so the action mutation can refresh it', () => {
    expect(fulfillmentQueryKeys.detail('ol_work_1')).toEqual([
      'fulfillment',
      'works',
      'detail',
      'ol_work_1',
    ]);
    expect(fulfillmentQueryKeys.detail('ol_work_1')[0]).toBe(fulfillmentQueryKeys.all[0]);
  });
});
