/**
 * useNavCounts
 *
 * Fans out the existing feature list-queries to surface a count badge
 * per nav item in the AppShell sidebar. No new backend endpoint — each
 * probe hits the existing list endpoint with `{ limit: 1 }`, so the
 * payload is small and TanStack Query dedupes against list-page visits
 * via matching query keys.
 *
 * Each count is `null` while its query is loading or in error so the
 * sidebar can render an empty slot instead of an arbitrary placeholder.
 * Failure counts (jobs, webhooks) are scoped to the terminal states that
 * need operator attention ('dead' / 'failed' / 'deadlettered').
 */
import { useConnectionsQuery } from '../../features/connections/hooks/use-connections-query';
import { useCustomersQuery } from '../../features/customers/hooks/use-customers-query';
import { useListingsQuery } from '../../features/listings/hooks/use-listings-query';
import { useOrdersQuery } from '../../features/orders/hooks/use-orders-query';
import { useSyncJobsQuery } from '../../features/sync-jobs/hooks/use-sync-jobs-query';
import { useWebhookDeliveriesQuery } from '../../features/webhook-deliveries/hooks/use-webhook-deliveries-query';

export interface NavCounts {
  connections: number | null;
  customers: number | null;
  jobsFailed: number | null;
  listings: number | null;
  orders: number | null;
  webhooksFailed: number | null;
}

const PROBE = { limit: 1 } as const;

export function useNavCounts(): NavCounts {
  const connections = useConnectionsQuery();
  const orders = useOrdersQuery(undefined, PROBE);
  const customers = useCustomersQuery(undefined, PROBE);
  const listings = useListingsQuery(undefined, PROBE);
  const jobsFailed = useSyncJobsQuery({ status: 'dead' }, PROBE);
  const webhooksFailed = useWebhookDeliveriesQuery({ status: 'failed' }, PROBE);

  return {
    connections: connections.data?.length ?? null,
    orders: orders.data?.total ?? null,
    customers: customers.data?.total ?? null,
    listings: listings.data?.total ?? null,
    jobsFailed: jobsFailed.data?.total ?? null,
    webhooksFailed: webhooksFailed.data?.total ?? null,
  };
}
