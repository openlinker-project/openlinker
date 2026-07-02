import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { connectionsQueryKeys } from '../api/connections.query-keys';
import { useApiClient } from '../../../app/api/api-client-provider';

interface SetDefaultBankAccountVariables {
  connectionId: string;
  accountId: string;
}

/**
 * Marks a bank account as the provider's default (#1303 follow-up) — keeps
 * inFakt's own "default account" setting in sync with the account
 * OpenLinker stamps on Transfer invoices, whenever the operator picks one.
 */
export function useSetDefaultBankAccountMutation(): UseMutationResult<
  void,
  Error,
  SetDefaultBankAccountVariables
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ connectionId, accountId }: SetDefaultBankAccountVariables) =>
      apiClient.connections.setDefaultBankAccount(connectionId, accountId),
    onSuccess: async (_data, { connectionId }) => {
      await queryClient.invalidateQueries({
        queryKey: connectionsQueryKeys.bankAccounts(connectionId),
      });
    },
  });
}
