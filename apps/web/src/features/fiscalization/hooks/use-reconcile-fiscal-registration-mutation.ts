/**
 * useReconcileFiscalRegistrationMutation (#1909)
 *
 * Mutation for `POST /fiscal-registrations/:id/reconcile` — the only sanctioned
 * way out of an `in-doubt` outcome other than an operator decision. Never a
 * resend; it asks the provider by business coordinates.
 *
 * @module apps/web/src/features/fiscalization/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { fiscalizationQueryKeys } from '../api/fiscalization.query-keys';
import type { FiscalRegistrationRecord, ReconcileFiscalRegistrationResult } from '../api/fiscalization.types';

interface ReconcileInput {
  id: string;
  orderId: string;
}

export function useReconcileFiscalRegistrationMutation(): UseMutationResult<
  ReconcileFiscalRegistrationResult,
  Error,
  ReconcileInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<ReconcileFiscalRegistrationResult, Error, ReconcileInput>({
    mutationFn: ({ id }) => apiClient.fiscalization.reconcile(id),
    onSuccess: (result, input) => {
      queryClient.setQueryData<FiscalRegistrationRecord[]>(
        fiscalizationQueryKeys.forOrder(input.orderId),
        (existing) => {
          const rest = (existing ?? []).filter((r) => r.id !== result.record.id);
          return [result.record, ...rest];
        },
      );
    },
  });
}
