/**
 * useSendReceiptEmailMutation (#3550)
 *
 * Mutation for `POST /fiscal-registrations/:id/send-email`: OpenLinker mails the
 * buyer its own summary of the receipt plus the link to the legal e-receipt.
 *
 * @module apps/web/src/features/fiscalization/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { fiscalizationQueryKeys } from '../api/fiscalization.query-keys';
import type { SendReceiptEmailInput, SendReceiptEmailResult } from '../api/fiscalization.types';

export interface SendReceiptEmailVariables {
  id: string;
  input: SendReceiptEmailInput;
}

export function useSendReceiptEmailMutation(): UseMutationResult<
  SendReceiptEmailResult,
  Error,
  SendReceiptEmailVariables
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<SendReceiptEmailResult, Error, SendReceiptEmailVariables>({
    mutationFn: ({ id, input }) => apiClient.fiscalization.sendEmail(id, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: fiscalizationQueryKeys.all });
    },
  });
}
