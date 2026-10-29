/**
 * Send Buyer Email Test Mutation (#3555)
 *
 * The template editor's "Send test email". Nothing is cached or invalidated:
 * a test send is not recorded anywhere.
 *
 * @module apps/web/src/features/buyer-emails/hooks
 */
import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import type { SendBuyerEmailTestInput } from '../api/buyer-emails.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useSendBuyerEmailTestMutation(): UseMutationResult<
  void,
  Error,
  SendBuyerEmailTestInput
> {
  const apiClient = useApiClient();
  return useMutation({
    mutationFn: (input: SendBuyerEmailTestInput) => apiClient.buyerEmails.sendTest(input),
  });
}
