/**
 * Prompt Template Mutation Hooks
 *
 * Create / update / publish / revert / delete mutations. Each invalidates
 * `promptTemplatesQueryKeys.all` on success so the list + detail + versions
 * queries refetch in lockstep.
 *
 * @module apps/web/src/features/prompt-templates/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { promptTemplatesQueryKeys } from '../api/prompt-templates.query-keys';
import type {
  CreatePromptTemplateInput,
  PromptTemplate,
  RevertPromptTemplateInput,
  UpdatePromptTemplateInput,
} from '../api/prompt-templates.types';

interface UpdateArgs {
  id: string;
  input: UpdatePromptTemplateInput;
}

export function useCreatePromptTemplateMutation(): UseMutationResult<
  PromptTemplate,
  Error,
  CreatePromptTemplateInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) => apiClient.promptTemplates.create(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: promptTemplatesQueryKeys.all });
    },
  });
}

export function useUpdatePromptTemplateDraftMutation(): UseMutationResult<
  PromptTemplate,
  Error,
  UpdateArgs
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }) => apiClient.promptTemplates.update(id, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: promptTemplatesQueryKeys.all });
    },
  });
}

export function usePublishPromptTemplateMutation(): UseMutationResult<
  PromptTemplate,
  Error,
  string
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => apiClient.promptTemplates.publish(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: promptTemplatesQueryKeys.all });
    },
  });
}

export function useRevertPromptTemplateMutation(): UseMutationResult<
  PromptTemplate,
  Error,
  RevertPromptTemplateInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) => apiClient.promptTemplates.revert(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: promptTemplatesQueryKeys.all });
    },
  });
}

export function useDeletePromptTemplateMutation(): UseMutationResult<void, Error, string> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => apiClient.promptTemplates.remove(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: promptTemplatesQueryKeys.all });
    },
  });
}
