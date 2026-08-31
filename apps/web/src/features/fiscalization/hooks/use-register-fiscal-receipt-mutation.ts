/**
 * useRegisterFiscalReceiptMutation (#1909, reworked by #2527)
 *
 * Mutation for `POST /fiscal-registrations` - the manual, explicit-operator-
 * request trigger (ADR-042: v1 registers on nothing else).
 *
 * Since #2525 the endpoint ACCEPTS the work rather than performing it, so there
 * is no record in the answer to seed a cache with. What the mutation can do is
 * make both per-order reads re-fetch, and the progress read then polls itself to
 * the outcome. That is the whole reason the panel survives being closed: nothing
 * about the result depends on this mutation's promise still being alive.
 *
 * @module apps/web/src/features/fiscalization/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { fiscalizationQueryKeys } from '../api/fiscalization.query-keys';
import type {
  AcceptedFiscalRegistration,
  RegisterFiscalTransactionInput,
} from '../api/fiscalization.types';

export function useRegisterFiscalReceiptMutation(): UseMutationResult<
  AcceptedFiscalRegistration,
  Error,
  RegisterFiscalTransactionInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<AcceptedFiscalRegistration, Error, RegisterFiscalTransactionInput>({
    mutationFn: (input) => apiClient.fiscalization.register(input),
    onSuccess: async (_accepted, input) => {
      // Both reads, and the progress one first in intent: it is the one that can
      // report the accepted-but-not-yet-running window, which the record list
      // renders as an order nobody asked to register.
      await queryClient.invalidateQueries({
        queryKey: fiscalizationQueryKeys.progressForOrder(input.orderId, input.connectionId),
      });
      await queryClient.invalidateQueries({
        queryKey: fiscalizationQueryKeys.forOrder(input.orderId),
      });
    },
  });
}
