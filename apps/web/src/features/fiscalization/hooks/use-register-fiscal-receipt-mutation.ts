/**
 * useRegisterFiscalReceiptMutation (#1909)
 *
 * Mutation for `POST /fiscal-registrations` — the manual, explicit-operator-
 * request trigger (ADR-042: v1 registers on nothing else). On success, seeds
 * the per-order list cache by upserting the returned record rather than
 * discarding the list, and invalidates only while the row is still in flight
 * so the poll takes over from there.
 *
 * @module apps/web/src/features/fiscalization/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { fiscalizationQueryKeys } from '../api/fiscalization.query-keys';
import type {
  FiscalRegistrationRecord,
  RegisterFiscalTransactionInput,
} from '../api/fiscalization.types';

function upsertRecord(
  existing: FiscalRegistrationRecord[] | undefined,
  record: FiscalRegistrationRecord,
): FiscalRegistrationRecord[] {
  const rest = (existing ?? []).filter((r) => r.id !== record.id);
  return [record, ...rest];
}

export function useRegisterFiscalReceiptMutation(): UseMutationResult<
  FiscalRegistrationRecord,
  Error,
  RegisterFiscalTransactionInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<FiscalRegistrationRecord, Error, RegisterFiscalTransactionInput>({
    mutationFn: (input) => apiClient.fiscalization.register(input),
    onSuccess: async (record, input) => {
      queryClient.setQueryData<FiscalRegistrationRecord[]>(
        fiscalizationQueryKeys.forOrder(input.orderId),
        (existing) => upsertRecord(existing, record),
      );
      if (record.status === 'pending' || record.status === 'registering') {
        await queryClient.invalidateQueries({
          queryKey: fiscalizationQueryKeys.forOrder(input.orderId),
        });
      }
    },
  });
}
