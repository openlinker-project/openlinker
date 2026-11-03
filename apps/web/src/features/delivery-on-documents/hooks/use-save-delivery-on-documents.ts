/**
 * useSaveDeliveryOnDocuments (#3908)
 *
 * Persists the delivery-line settings for one connection. Fetch-fresh-then-
 * merge, like `useUpdateSalesDocumentMutation`: a sibling panel or another
 * operator may have written a different config key after this page loaded and
 * `PATCH` replaces `config` wholesale. The actual write is delegated to
 * `useUpdateConnectionMutation` so cache invalidation stays owned in one place.
 *
 * @module apps/web/src/features/delivery-on-documents/hooks
 */
import { useCallback } from 'react';
import { useApiClient } from '../../../app/api/api-client-provider';
import { useUpdateConnectionMutation } from '../../connections';
import type { DeliveryOnDocumentsConfig } from '../lib/delivery-line';
import { mergeDeliveryOnDocumentsConfig } from '../lib/merge-delivery-on-documents-config';

export interface UseSaveDeliveryOnDocumentsResult {
  save: (connectionId: string, next: DeliveryOnDocumentsConfig | null) => Promise<void>;
  isPending: boolean;
}

export function useSaveDeliveryOnDocuments(): UseSaveDeliveryOnDocumentsResult {
  const apiClient = useApiClient();
  const updateConnection = useUpdateConnectionMutation();

  const save = useCallback(
    async (connectionId: string, next: DeliveryOnDocumentsConfig | null): Promise<void> => {
      const fresh = await apiClient.connections.getById(connectionId);
      const config = mergeDeliveryOnDocumentsConfig(fresh.config, next);
      await updateConnection.mutateAsync({ connectionId, input: { config } });
    },
    [apiClient, updateConnection],
  );

  return { save, isPending: updateConnection.isPending };
}
