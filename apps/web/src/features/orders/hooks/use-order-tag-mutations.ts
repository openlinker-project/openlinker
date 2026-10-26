/**
 * Order Tag Mutation Hooks (#3532, D34)
 *
 * Create/assign/unassign/bulk-assign, each invalidating the affected caches:
 * the workspace vocabulary (`orders.tags`, whose counts change on every
 * assignment), the per-order assignment (`orders.orderTags`), and the list
 * itself (`orders.list`/`orders.rows`) so a row's tag chips and the tag
 * filter's counts stay current.
 *
 * @module apps/web/src/features/orders/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { ordersQueryKeys } from '../api/orders.query-keys';
import type { BulkAssignOrderTagResult, OrderTag, OrderTagColorValue } from '../api/orders.types';

function useInvalidateOrdersList(): () => Promise<void> {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({ queryKey: ordersQueryKeys.all, exact: false });
}

export function useCreateOrderTagMutation(): UseMutationResult<
  OrderTag,
  Error,
  { name: string; color: OrderTagColorValue }
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ name, color }) => apiClient.orders.createTag(name, color),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ordersQueryKeys.tags() });
    },
  });
}

export function useUpdateOrderTagMutation(): UseMutationResult<
  OrderTag,
  Error,
  { tagId: string; patch: { name?: string; color?: OrderTagColorValue } }
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ tagId, patch }) => apiClient.orders.updateTag(tagId, patch),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ordersQueryKeys.tags() });
    },
  });
}

export function useDeleteOrderTagMutation(): UseMutationResult<void, Error, string> {
  const apiClient = useApiClient();
  const invalidateList = useInvalidateOrdersList();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (tagId) => apiClient.orders.deleteTag(tagId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ordersQueryKeys.tags() }),
        invalidateList(),
      ]);
    },
  });
}

export function useAssignOrderTagMutation(
  internalOrderId: string,
): UseMutationResult<void, Error, string> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const invalidateList = useInvalidateOrdersList();

  return useMutation({
    mutationFn: (tagId) => apiClient.orders.assignTag(internalOrderId, tagId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ordersQueryKeys.orderTags(internalOrderId) }),
        queryClient.invalidateQueries({ queryKey: ordersQueryKeys.tags() }),
        invalidateList(),
      ]);
    },
  });
}

export function useUnassignOrderTagMutation(
  internalOrderId: string,
): UseMutationResult<void, Error, string> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const invalidateList = useInvalidateOrdersList();

  return useMutation({
    mutationFn: (tagId) => apiClient.orders.unassignTag(internalOrderId, tagId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ordersQueryKeys.orderTags(internalOrderId) }),
        queryClient.invalidateQueries({ queryKey: ordersQueryKeys.tags() }),
        invalidateList(),
      ]);
    },
  });
}

/** The bulk action bar's "Tags" action (#3533). */
export function useBulkAssignOrderTagMutation(): UseMutationResult<
  BulkAssignOrderTagResult,
  Error,
  { tagId: string; orderIds: string[] }
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const invalidateList = useInvalidateOrdersList();

  return useMutation({
    mutationFn: ({ tagId, orderIds }) => apiClient.orders.bulkAssignTag(tagId, orderIds),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ordersQueryKeys.tags() }),
        invalidateList(),
      ]);
    },
  });
}
