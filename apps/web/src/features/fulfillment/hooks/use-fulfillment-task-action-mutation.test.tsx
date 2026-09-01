/**
 * `useFulfillmentTaskActionMutation` tests (#2411)
 *
 * One property, and it is a cross-consumer one: the invalidation is
 * FEATURE-WIDE, not order-scoped.
 *
 * A panel-level test cannot hold it. The order-detail panel has exactly one
 * cached fulfilment query, so `worksByOrder(orderId)` and `all` refresh the
 * same thing there and the panel's own 409 tests pass under either key. The
 * property only bites once a second query renders the same task under a
 * different key — #2410's worklist, whose rows are keyed by FILTERS. Under the
 * narrow key an action taken from the worklist refreshes the order panel and
 * leaves the worklist's row holding a stale `version`; the operator's next
 * click is then a 409 the UI manufactured out of its own cache.
 *
 * So the fixture records the key the hook invalidates and asserts it REACHES a
 * sibling key the hook has never heard of — prefix-matching, which is how
 * TanStack Query itself decides what an invalidation covers. Asserting reach
 * rather than `toEqual(['fulfillment'])` holds the property rather than the
 * spelling: any key that still covers both consumers passes. Narrow it back to
 * `worksByOrder` and this file goes red while every other test in the slice
 * stays green — which is the point, since the panel's own tests pass under
 * either key.
 *
 * @module apps/web/src/features/fulfillment/hooks
 */
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import { ApiError } from '../../../shared/api/api-error';
import { fulfillmentQueryKeys } from '../api/fulfillment.query-keys';
import { useFulfillmentTaskActionMutation } from './use-fulfillment-task-action-mutation';

const ORDER_ID = 'ol_order_1';
/**
 * A sibling of `worksByOrder` under the same feature root — the shape #2410's
 * worklist uses. Written literally rather than imported, because the point is
 * that the hook must reach a key it does not know about.
 */
const WORKLIST_KEY = ['fulfillment', 'works', 'list', { status: 'open' }] as const;

interface Harness {
  mutation: ReturnType<typeof useFulfillmentTaskActionMutation>;
  queryClient: QueryClient;
  /** Every key the hook asked to invalidate, in order. */
  invalidated: unknown[][];
}

function renderMutation(applyAction: ReturnType<typeof vi.fn>): Harness {
  const captured: Partial<Harness> = {};

  function Probe(): null {
    captured.mutation = useFulfillmentTaskActionMutation();
    captured.queryClient = useQueryClient();
    return null;
  }

  renderWithProviders(<Probe />, {
    apiClient: createMockApiClient({ fulfillment: { applyAction } as never }),
  });

  const queryClient = captured.queryClient as QueryClient;
  const invalidated: unknown[][] = [];
  const original = queryClient.invalidateQueries.bind(queryClient);
  queryClient.invalidateQueries = ((filters?: { queryKey?: unknown[] }) => {
    if (filters?.queryKey) invalidated.push(filters.queryKey);
    return original(filters as never);
  }) as QueryClient['invalidateQueries'];

  return { ...(captured as Harness), invalidated };
}

/**
 * Does an invalidation of `invalidatedKey` cover a query cached at `target`?
 * Prefix match on serialised segments — the rule TanStack Query applies.
 */
function reaches(invalidatedKey: unknown[], target: readonly unknown[]): boolean {
  if (invalidatedKey.length > target.length) return false;
  return invalidatedKey.every(
    (segment, index) => JSON.stringify(segment) === JSON.stringify(target[index])
  );
}

describe('useFulfillmentTaskActionMutation (#2411)', () => {
  it('should invalidate every fulfilment query on success, not just the acting order', async () => {
    const applyAction = vi.fn().mockResolvedValue({ id: 'ol_work_1' });
    const { mutation, invalidated } = renderMutation(applyAction);

    mutation.mutate({ workId: 'ol_work_1', action: 'schedule', orderId: ORDER_ID, expectedVersion: 7 });

    await waitFor(() => {
      expect(invalidated.some((key) => reaches(key, WORKLIST_KEY))).toBe(true);
    });
    expect(
      invalidated.some((key) => reaches(key, fulfillmentQueryKeys.worksByOrder(ORDER_ID)))
    ).toBe(true);
  });

  it('should invalidate every fulfilment query after a 409, so no cached row keeps a stale version', async () => {
    const applyAction = vi
      .fn()
      .mockRejectedValue(new ApiError('stale', 409, { code: 'version_conflict', currentVersion: 9 }));
    const { mutation, invalidated } = renderMutation(applyAction);

    mutation.mutate({ workId: 'ol_work_1', action: 'schedule', orderId: ORDER_ID, expectedVersion: 7 });

    await waitFor(() => {
      expect(invalidated.some((key) => reaches(key, WORKLIST_KEY))).toBe(true);
    });
    expect(
      invalidated.some((key) => reaches(key, fulfillmentQueryKeys.worksByOrder(ORDER_ID)))
    ).toBe(true);
  });

  it('should leave the cache alone for a failure that says nothing about staleness', async () => {
    const applyAction = vi.fn().mockRejectedValue(new ApiError('boom', 500, {}));
    const { mutation, invalidated } = renderMutation(applyAction);

    mutation.mutate({ workId: 'ol_work_1', action: 'schedule', orderId: ORDER_ID, expectedVersion: 7 });

    await waitFor(() => {
      expect(applyAction).toHaveBeenCalledTimes(1);
    });
    expect(invalidated).toHaveLength(0);
  });
});
