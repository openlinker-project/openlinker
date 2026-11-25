/**
 * Buyer Data Scopes Plan (#4289)
 *
 * The plan for several connections at once, each under ITS OWN effective rules.
 * The enable confirmation needs it: turning the general switch on also starts
 * connections that carry rules of their own, and the operator must see the
 * count for every one of them, not only for the defaults. Same query keys as
 * the studio's plan, so an answer already on screen is reused.
 *
 * @module apps/web/src/features/buyer-data/hooks
 */
import { useQueries } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { buyerDataQueryKeys } from '../api/buyer-data.query-keys';
import type { BuyerDataEraseMode, BuyerDataPreview } from '../api/buyer-data.types';
import { validateBuyerDataRules } from '../lib/buyer-data-config';

export interface ScopePlanRequest {
  connectionId: string;
  hideAfterDays: number;
  eraseAfterDays: number;
  mode: BuyerDataEraseMode;
}

export function useBuyerDataScopesPlan(
  scopes: readonly ScopePlanRequest[],
  options: { enabled?: boolean } = {}
): Record<string, BuyerDataPreview | undefined> {
  const apiClient = useApiClient();
  const results = useQueries({
    queries: scopes.map((scope) => ({
      queryKey: buyerDataQueryKeys.plan(scope),
      queryFn: ({ signal }: { signal: AbortSignal }) => apiClient.buyerData.preview(scope, signal),
      enabled: (options.enabled ?? true) && validateBuyerDataRules(scope).length === 0,
      staleTime: 30_000,
    })),
  });
  const byId: Record<string, BuyerDataPreview | undefined> = {};
  scopes.forEach((scope, index) => {
    byId[scope.connectionId] = results[index]?.data;
  });
  return byId;
}
