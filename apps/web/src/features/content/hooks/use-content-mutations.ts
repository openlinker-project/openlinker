/**
 * Content Mutation Hooks
 *
 * Save draft / discard draft / publish / AI suggest. Each mutation that
 * changes persisted state invalidates `contentQueryKeys.forProduct(productId)`
 * on success so the state endpoint is re-fetched. `suggest` does not
 * invalidate — it only returns a suggestion to the caller.
 *
 * @module apps/web/src/features/content/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { contentQueryKeys } from '../api/content.query-keys';
import type {
  ContentFieldResponse,
  DiscardContentDraftInput,
  PublishContentInput,
  SaveContentDraftInput,
  SuggestContentInput,
  SuggestionResponse,
} from '../api/content.types';

interface SaveArgs {
  productId: string;
  input: SaveContentDraftInput;
}

interface DiscardArgs {
  productId: string;
  input: DiscardContentDraftInput;
}

interface PublishArgs {
  productId: string;
  input: PublishContentInput;
}

interface SuggestArgs {
  productId: string;
  input: SuggestContentInput;
}

export function useSaveContentDraftMutation(): UseMutationResult<ContentFieldResponse, Error, SaveArgs> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, input }) => apiClient.content.saveDraft(productId, input),
    onSuccess: async (_result, variables) => {
      await queryClient.invalidateQueries({
        queryKey: contentQueryKeys.forProduct(variables.productId),
      });
    },
  });
}

export function useDiscardContentDraftMutation(): UseMutationResult<void, Error, DiscardArgs> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, input }) => apiClient.content.discardDraft(productId, input),
    onSuccess: async (_result, variables) => {
      await queryClient.invalidateQueries({
        queryKey: contentQueryKeys.forProduct(variables.productId),
      });
    },
  });
}

export function usePublishContentMutation(): UseMutationResult<ContentFieldResponse, Error, PublishArgs> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, input }) => apiClient.content.publish(productId, input),
    onSuccess: async (_result, variables) => {
      await queryClient.invalidateQueries({
        queryKey: contentQueryKeys.forProduct(variables.productId),
      });
    },
  });
}

export function useSuggestContentMutation(): UseMutationResult<SuggestionResponse, Error, SuggestArgs> {
  const apiClient = useApiClient();
  return useMutation({
    mutationFn: ({ productId, input }) => apiClient.content.suggest(productId, input),
  });
}
