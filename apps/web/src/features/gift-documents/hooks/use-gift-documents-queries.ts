/**
 * Gift documents - read hooks (#3941)
 *
 * @module apps/web/src/features/gift-documents/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { giftDocumentsQueryKeys } from '../api/gift-documents.query-keys';
import type {
  DocumentProvidersResponse,
  GiftDocumentSettingsResponse,
} from '../api/gift-documents.types';

export function useGiftDocumentSettingsQuery(): UseQueryResult<GiftDocumentSettingsResponse> {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: giftDocumentsQueryKeys.settings(),
    queryFn: () => apiClient.giftDocuments.getSettings(),
  });
}

/** Enrichment only: a failure removes the "Shown at 0.00" availability, never the form. */
export function useDocumentProvidersQuery(): UseQueryResult<DocumentProvidersResponse> {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: giftDocumentsQueryKeys.providers(),
    queryFn: () => apiClient.giftDocuments.getProviders(),
    staleTime: 5 * 60 * 1000,
  });
}
