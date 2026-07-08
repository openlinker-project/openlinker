import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { syncJobsQueryKeys } from '../api/sync.query-keys';
import type { WebhookJobLookupInput } from '../api/sync.api';
import type { SyncJob } from '../api/sync-jobs.types';
import { useApiClient } from '../../../app/api/api-client-provider';

/**
 * Resolves the persisted SyncJob a webhook trigger enqueued, so a caller
 * holding only the inbound event's components (e.g. a webhook delivery) can
 * link to the concrete job it produced (#1366). The server assembles the
 * idempotency key from the passed components — the format is not re-encoded
 * here.
 *
 * A 404 (job not created yet — worker is asynchronous) surfaces as the query's
 * error state and is NOT retried: the caller degrades gracefully rather than
 * hammering the endpoint. Self-disables until all components are present.
 */
export function useSyncJobLookupQuery(
  input: WebhookJobLookupInput | null
): UseQueryResult<SyncJob> {
  const apiClient = useApiClient();
  const enabled = Boolean(input && input.platformType && input.connectionId && input.eventId);

  return useQuery({
    queryKey: syncJobsQueryKeys.webhookJobLookup(
      input?.platformType ?? '',
      input?.connectionId ?? '',
      input?.eventId ?? ''
    ),
    // Guarded by `enabled` — `input` is non-null whenever the query runs.
    queryFn: () => apiClient.syncJobs.lookupJobForWebhookEvent(input as WebhookJobLookupInput),
    enabled,
    retry: false,
  });
}
