/**
 * Currency Remediation Status Query Hook
 *
 * Polls `GET /analytics/coverage/currency/status/:runId` (#2468) — the real
 * driver behind the Data Coverage panel's currency row sub-states
 * (`in-progress` / `resolved` / `failed`). Never a client-only timer: the
 * row transitions only when this poll observes the persisted
 * `analytics_remediation_runs.status` actually change (#2474 Phase 7 AC).
 *
 * Polling stops once the run reaches a terminal state (`resolved` /
 * `failed`) — a finished run's status cannot change again, so continuing to
 * poll would be pure waste.
 *
 * @module apps/web/src/features/analytics/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { analyticsRemediationQueryKeys } from '../api/analytics-remediation.query-keys';
import type { AnalyticsRemediationRun } from '../api/analytics-remediation.types';

const POLL_INTERVAL_MS = 2500;

export function useCurrencyRemediationStatusQuery(
  runId: string | null
): UseQueryResult<AnalyticsRemediationRun> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: analyticsRemediationQueryKeys.status(runId ?? ''),
    queryFn: () => apiClient.analytics.getCurrencyRemediationStatus(runId as string),
    enabled: runId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'resolved' || status === 'failed' ? false : POLL_INTERVAL_MS;
    },
  });
}
