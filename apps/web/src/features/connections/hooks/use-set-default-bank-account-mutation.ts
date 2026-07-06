import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { connectionsQueryKeys } from '../api/connections.query-keys';
import { useApiClient } from '../../../app/api/api-client-provider';
import { useToast } from '../../../shared/ui/toast-provider';

interface SetDefaultBankAccountVariables {
  connectionId: string;
  accountId: string;
}

/**
 * Marks a bank account as the provider's default (#1303 follow-up) — keeps
 * inFakt's own "default account" setting in sync with the account
 * OpenLinker stamps on Transfer invoices, whenever the operator picks one.
 *
 * A failed call leaves OL and inFakt disagreeing about the default, so the
 * hook surfaces the failure via a toast — call sites fire-and-forget with
 * `.mutate()` and rely on this single error seam.
 */
export function useSetDefaultBankAccountMutation(): UseMutationResult<
  void,
  Error,
  SetDefaultBankAccountVariables
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  return useMutation({
    mutationFn: ({ connectionId, accountId }: SetDefaultBankAccountVariables) =>
      apiClient.connections.setDefaultBankAccount(connectionId, accountId),
    onSuccess: async (_data, { connectionId }) => {
      await queryClient.invalidateQueries({
        queryKey: connectionsQueryKeys.bankAccounts(connectionId),
      });
    },
    onError: (error) => {
      showToast({
        tone: 'error',
        title: 'Could not update the inFakt default account',
        description: `The account was saved in OpenLinker but inFakt still shows the previous default. ${error.message}`,
      });
    },
  });
}
