/**
 * useSetNumberingAssignmentMutation (#1577)
 *
 * Attaches / replaces a connection's numbering assignment (main + optional
 * correction series). Invalidates the numbering domain on success — the
 * assignment and the unassigned list both change.
 *
 * @module apps/web/src/features/invoicing/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { numberingQueryKeys } from '../api/numbering.query-keys';
import type { NumberingAssignment, SetNumberingAssignmentInput } from '../api/numbering.types';

export interface SetNumberingAssignmentVariables {
  connectionId: string;
  input: SetNumberingAssignmentInput;
}

export function useSetNumberingAssignmentMutation(): UseMutationResult<
  NumberingAssignment,
  Error,
  SetNumberingAssignmentVariables
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ connectionId, input }) =>
      apiClient.invoiceNumbering.setAssignment(connectionId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: numberingQueryKeys.all });
    },
  });
}
