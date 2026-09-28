/**
 * Order Note Mutation Hooks (#3531)
 *
 * Create/update/delete, all invalidating the notes query on success — no
 * optimistic update, since attribution (`authorUsername`) and `editedAt` are
 * server-stamped.
 *
 * @module apps/web/src/features/orders/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { ordersQueryKeys } from '../api/orders.query-keys';
import type { CreateOrderNoteRequest, OrderNote, UpdateOrderNoteRequest } from '../api/orders.types';

export function useCreateOrderNoteMutation(
  internalOrderId: string,
): UseMutationResult<OrderNote, Error, CreateOrderNoteRequest> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body) => apiClient.orders.createNote(internalOrderId, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ordersQueryKeys.notes(internalOrderId) });
    },
  });
}

export function useUpdateOrderNoteMutation(
  internalOrderId: string,
): UseMutationResult<OrderNote, Error, { noteId: string; body: UpdateOrderNoteRequest }> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ noteId, body }) => apiClient.orders.updateNote(internalOrderId, noteId, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ordersQueryKeys.notes(internalOrderId) });
    },
  });
}

export function useDeleteOrderNoteMutation(
  internalOrderId: string,
): UseMutationResult<void, Error, string> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (noteId) => apiClient.orders.deleteNote(internalOrderId, noteId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ordersQueryKeys.notes(internalOrderId) });
    },
  });
}
