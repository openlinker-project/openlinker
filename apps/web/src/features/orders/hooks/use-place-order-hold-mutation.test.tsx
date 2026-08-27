/**
 * Order-hold mutation hooks — refetch-on-conflict tests (#2342 review).
 *
 * `holdWriteErrorNeedsRefresh` was exported, spec'd and called by nothing, while
 * the conflict copy told the operator to reload by hand on a screen where every
 * success path already invalidates. The hooks now do it, and this is where that
 * is pinned — including the negative case, because invalidating on EVERY failure
 * would refetch the whole orders domain on a validation 400.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { usePlaceOrderHoldMutation } from './use-place-order-hold-mutation';
import { useReleaseOrderHoldMutation } from './use-release-order-hold-mutation';
import { ApiClientProvider } from '../../../app/api/api-client-provider';
import { createMockApiClient } from '../../../test/test-utils';
import { ordersQueryKeys } from '../api/orders.query-keys';
import { ApiError } from '../../../shared/api/api-error';

const ORDER_ID = 'ol_order_1';

function conflict(code: string): ApiError {
  return new ApiError('conflict', 409, {
    statusCode: 409,
    error: code,
    message: 'conflict',
  });
}

type AnyMock = ReturnType<typeof vi.fn>;

function setup(placeHold: AnyMock, releaseHold: AnyMock) {
  const apiClient = createMockApiClient({
    orders: { placeHold, releaseHold } as never,
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );

  const place = renderHook(() => usePlaceOrderHoldMutation(), { wrapper });
  const release = renderHook(() => useReleaseOrderHoldMutation(), { wrapper });
  return { invalidateSpy, place, release };
}

describe('order-hold mutation hooks — refetch on conflict (#2342 review)', () => {
  it('refetches the orders domain when placing hits ORDER_ALREADY_ON_HOLD', async () => {
    const placeHold = vi.fn().mockRejectedValue(conflict('ORDER_ALREADY_ON_HOLD'));
    const { invalidateSpy, place } = setup(placeHold, vi.fn());

    place.result.current.mutate({ internalOrderId: ORDER_ID, reason: 'operator' });

    await waitFor(() => {
      expect(place.result.current.isError).toBe(true);
    });
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ordersQueryKeys.all });
    });
  });

  it('refetches the orders domain when releasing hits HOLD_ALREADY_RELEASED', async () => {
    const releaseHold = vi.fn().mockRejectedValue(conflict('HOLD_ALREADY_RELEASED'));
    const { invalidateSpy, release } = setup(vi.fn(), releaseHold);

    release.result.current.mutate({
      internalOrderId: ORDER_ID,
      holdId: 'hold_1',
      note: undefined,
    });

    await waitFor(() => {
      expect(release.result.current.isError).toBe(true);
    });
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ordersQueryKeys.all });
    });
  });

  it('does NOT refetch on a contended conflict, whose remedy is to press the button again', async () => {
    // The client's view is not stale: a peer took and RELEASED the slot.
    const placeHold = vi.fn().mockRejectedValue(conflict('ORDER_HOLD_CONTENDED'));
    const { invalidateSpy, place } = setup(placeHold, vi.fn());

    place.result.current.mutate({ internalOrderId: ORDER_ID, reason: 'operator' });

    await waitFor(() => {
      expect(place.result.current.isError).toBe(true);
    });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('does NOT refetch on an ordinary validation failure', async () => {
    const placeHold = vi.fn().mockRejectedValue(new ApiError('bad', 400, { message: 'bad' }));
    const { invalidateSpy, place } = setup(placeHold, vi.fn());

    place.result.current.mutate({ internalOrderId: ORDER_ID, reason: 'operator' });

    await waitFor(() => {
      expect(place.result.current.isError).toBe(true);
    });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
