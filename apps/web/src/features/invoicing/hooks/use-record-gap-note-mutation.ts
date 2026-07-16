/**
 * useRecordGapNoteMutation
 *
 * Records the operator's neutral written explanation for a numbering gap (the PL
 * "oświadczenie o pominięciu numeru"). Invalidates the numbering domain on
 * success so the audit read model reflects the new note.
 *
 * @module apps/web/src/features/invoicing/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { numberingQueryKeys } from '../api/numbering.query-keys';
import type { NumberingGapNote, RecordGapNoteInput } from '../api/numbering.types';

export interface RecordGapNoteVariables {
  seriesId: string;
  input: RecordGapNoteInput;
}

export function useRecordGapNoteMutation(): UseMutationResult<
  NumberingGapNote,
  Error,
  RecordGapNoteVariables
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ seriesId, input }) => apiClient.invoiceNumbering.recordGapNote(seriesId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: numberingQueryKeys.all });
    },
  });
}
