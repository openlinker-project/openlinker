/**
 * useCorrectionTargetQuery (#3567)
 *
 * Which master connection a manual correction of one variant would write to,
 * or the named reason it cannot. Enabled only while the dialog is open, and
 * never cached across opens: the answer depends on live connection state.
 *
 * @module apps/web/src/features/inventory/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { inventoryQueryKeys } from '../api/inventory.query-keys';
import type { CorrectionTarget } from '../api/inventory-correction.types';

export function useCorrectionTargetQuery(
  productVariantId: string | null,
): UseQueryResult<CorrectionTarget> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: inventoryQueryKeys.correctionTarget(productVariantId ?? ''),
    queryFn: () => apiClient.inventory.getCorrectionTarget(productVariantId ?? ''),
    enabled: productVariantId !== null,
    gcTime: 0,
    staleTime: 0,
  });
}
