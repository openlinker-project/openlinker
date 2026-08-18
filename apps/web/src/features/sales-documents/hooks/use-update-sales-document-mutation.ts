/**
 * useUpdateSalesDocumentMutation (#2159)
 *
 * Writes a `SalesDocumentConfigPatch` for one connection. Reuses the existing
 * `PATCH /connections/:id` surface verbatim — `config` is an open JSONB
 * passthrough (`UpdateConnectionDto.config: @IsObject()`, no schema), so no
 * backend change was needed to carry `config.salesDocument.documentKind`
 * alongside the `config.invoicing.{isPrimary,triggerModel}` fields #2047
 * already round-trips this way.
 *
 * Fetch-fresh-then-merge (not "patch what's in the query cache") for the same
 * reason `EditConnectionForm.onSubmit` refetches before submit: a sibling
 * panel (or another operator) may have written a different config key after
 * this page's data loaded, and `PATCH` replaces `config` wholesale.
 *
 * Delegates the actual write to `useUpdateConnectionMutation` (from the
 * `connections` feature) so cache invalidation stays owned in one place
 * rather than re-implemented here.
 *
 * @module apps/web/src/features/sales-documents/hooks
 */
import { useCallback } from 'react';
import { useApiClient } from '../../../app/api/api-client-provider';
import { useUpdateConnectionMutation } from '../../connections';
import { mergeSalesDocumentConfig } from '../lib/merge-sales-document-config';
import type { SalesDocumentConfigPatch } from '../api/sales-documents.types';

export interface UpdateSalesDocumentFieldInput {
  connectionId: string;
  patch: SalesDocumentConfigPatch;
}

export interface UseUpdateSalesDocumentMutationResult {
  updateField: (input: UpdateSalesDocumentFieldInput) => Promise<void>;
  isPending: boolean;
}

export function useUpdateSalesDocumentMutation(): UseUpdateSalesDocumentMutationResult {
  const apiClient = useApiClient();
  const updateConnection = useUpdateConnectionMutation();

  const updateField = useCallback(
    async ({ connectionId, patch }: UpdateSalesDocumentFieldInput): Promise<void> => {
      const fresh = await apiClient.connections.getById(connectionId);
      const config = mergeSalesDocumentConfig(fresh.config, patch);
      await updateConnection.mutateAsync({ connectionId, input: { config } });
    },
    [apiClient, updateConnection],
  );

  return { updateField, isPending: updateConnection.isPending };
}
