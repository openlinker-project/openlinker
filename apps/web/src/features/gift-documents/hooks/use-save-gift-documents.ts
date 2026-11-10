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
import {
  mergeGiftOnDocumentsConfig,
  type GiftConnectionOverrideInput,
} from '../lib/gift-on-documents-config';
import type { GiftDocumentSettingsResponse } from '../api/gift-documents.types';
import type { GiftDocumentFormChoice } from '../lib/gift-lines';

export interface SaveGiftDocumentDefaultInput {
  form: GiftDocumentFormChoice;
  unitPrice?: string;
}

export function useSaveGiftDocumentDefault(): UseMutationResult<
  GiftDocumentSettingsResponse,
  Error,
  SaveGiftDocumentDefaultInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ form, unitPrice }: SaveGiftDocumentDefaultInput) =>
      apiClient.giftDocuments.saveSettings(form, unitPrice),
    onSuccess: (saved) => {
      queryClient.setQueryData(giftDocumentsQueryKeys.settings(), saved);
    },
  });
}

export interface UseSaveGiftOnDocumentsResult {
  save: (connectionId: string, next: GiftConnectionOverrideInput | null) => Promise<void>;
  isPending: boolean;
}

export function useSaveGiftOnDocuments(): UseSaveGiftOnDocumentsResult {
  const apiClient = useApiClient();
  const updateConnection = useUpdateConnectionMutation();

  const save = useCallback(
    async (connectionId: string, next: GiftConnectionOverrideInput | null): Promise<void> => {
      const fresh = await apiClient.connections.getById(connectionId);
      const config = mergeGiftOnDocumentsConfig(fresh.config, next);
      await updateConnection.mutateAsync({ connectionId, input: { config } });
    },
    [apiClient, updateConnection],
  );

  return { save, isPending: updateConnection.isPending };
}
