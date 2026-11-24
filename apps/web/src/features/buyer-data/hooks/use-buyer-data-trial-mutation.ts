/**
 * Buyer Data Trial Run Mutation (#4289)
 *
 * The explicit "check now" action. Same endpoint as the impact counts, but
 * asked for on purpose, so the result can be shown with its masked samples and
 * can unlock the switch that turns the rules on. It writes nothing.
 *
 * @module apps/web/src/features/buyer-data/hooks
 */
import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import type { BuyerDataPreview, BuyerDataPreviewInput } from '../api/buyer-data.types';

export function useBuyerDataTrialMutation(): UseMutationResult<
  BuyerDataPreview,
  Error,
  BuyerDataPreviewInput
> {
  const apiClient = useApiClient();
  return useMutation({ mutationFn: (input) => apiClient.buyerData.preview(input) });
}
