/**
 * Routing dry-run mutation (#2954)
 *
 * A POST in shape but a read in effect: it changes no server state, so it
 * invalidates nothing. A mutation rather than a query because the operator
 * triggers it on demand with a body, and a cached "result" for yesterday's
 * stock would be a false answer.
 *
 * @module apps/web/src/features/oms/hooks
 */
import { useMutation, type UseMutationResult } from '@tanstack/react-query';

import { useApiClient } from '../../../app/api/api-client-provider';
import type { RoutingDryRunRequest, RoutingDryRunResult } from '../api/routing-dry-run.types';

export interface RoutingDryRunInput {
  connectionId: string;
  request: RoutingDryRunRequest;
}

export function useRoutingDryRunMutation(): UseMutationResult<
  RoutingDryRunResult,
  Error,
  RoutingDryRunInput
> {
  const apiClient = useApiClient();

  return useMutation({
    mutationFn: ({ connectionId, request }) => apiClient.routingDryRun.run(connectionId, request),
  });
}
