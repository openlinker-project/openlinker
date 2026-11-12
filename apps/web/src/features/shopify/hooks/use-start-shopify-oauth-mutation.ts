import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import type { StartShopifyOAuthInput, StartShopifyOAuthResponse } from '../api/shopify.api';

export function useStartShopifyOAuthMutation(): UseMutationResult<
  StartShopifyOAuthResponse,
  Error,
  StartShopifyOAuthInput
> {
  const apiClient = useApiClient();
  return useMutation({
    mutationFn: (input: StartShopifyOAuthInput) => apiClient.shopify.startOAuth(input),
  });
}
