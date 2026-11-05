/**
 * Gift documents - write hooks (#3941)
 *
 * `useSaveGiftDocumentDefault` saves the OpenLinker-wide default.
 * `useSaveGiftOnDocuments` saves one connection's override with
 * fetch-fresh-then-merge, like `useSaveDeliveryOnDocuments`: a sibling panel or
 * another operator may have written a different config key after this page
 * loaded and `PATCH` replaces `config` wholesale.
 *
 * @module apps/web/src/features/gift-documents/hooks
 */
import { useCallback } from 'react';
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { useUpdateConnectionMutation } from '../../connections';
import { giftDocumentsQueryKeys } from '../api/gift-documents.query-keys';
import { mergeGiftOnDocumentsConfig } from '../lib/gift-on-documents-config';
import type { GiftDocumentSettingsResponse } from '../api/gift-documents.types';
import type { GiftDocumentFormChoice } from '../lib/gift-lines';

export function useSaveGiftDocumentDefault(): UseMutationResult<
  GiftDocumentSettingsResponse,
  Error,
  GiftDocumentFormChoice
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (form: GiftDocumentFormChoice) => apiClient.giftDocuments.saveSettings(form),
    onSuccess: (saved) => {
      queryClient.setQueryData(giftDocumentsQueryKeys.settings(), saved);
    },
  });
}

export interface UseSaveGiftOnDocumentsResult {
  save: (connectionId: string, next: GiftDocumentFormChoice | null) => Promise<void>;
  isPending: boolean;
}

export function useSaveGiftOnDocuments(): UseSaveGiftOnDocumentsResult {
  const apiClient = useApiClient();
  const updateConnection = useUpdateConnectionMutation();

  const save = useCallback(
    async (connectionId: string, next: GiftDocumentFormChoice | null): Promise<void> => {
      const fresh = await apiClient.connections.getById(connectionId);
      const config = mergeGiftOnDocumentsConfig(fresh.config, next);
      await updateConnection.mutateAsync({ connectionId, input: { config } });
    },
    [apiClient, updateConnection],
  );

  return { save, isPending: updateConnection.isPending };
}
