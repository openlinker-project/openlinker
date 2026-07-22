/**
 * useOfferCreationRetry
 *
 * Re-point for the "Retry" affordance on a failed `OfferCreationTracker`
 * (#1754). Resolves the failed record's variant to its owning product, then
 * navigates into the unified bulk wizard pre-seeded with that single variant
 * and the original connection. The batch flow re-runs the same single-offer
 * core path, so the retry stays functionally equivalent to the retired
 * single-offer wizard's retry.
 *
 * Lives in the feature (not the page) so it can use `useApiClient` — page
 * modules are ESLint-blocked from importing `app/`.
 *
 * @module apps/web/src/features/listings/hooks
 */
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import { useApiClient } from '../../../app/api/api-client-provider';
import type { OfferCreationStatusResponse } from '../api/listings.types';

export function useOfferCreationRetry(): (
  record: OfferCreationStatusResponse,
) => Promise<void> {
  const apiClient = useApiClient();
  const navigate = useNavigate();

  return useCallback(
    async (record: OfferCreationStatusResponse) => {
      const summary = await apiClient.products.getVariant(record.internalVariantId);
      const params = new URLSearchParams({
        productIds: summary.productId,
        variantIds: record.internalVariantId,
        connectionId: record.connectionId,
      });
      await navigate(`/listings/bulk-create/wizard?${params.toString()}`);
    },
    [apiClient, navigate],
  );
}
