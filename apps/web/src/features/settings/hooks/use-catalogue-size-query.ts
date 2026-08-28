/**
 * Catalogue Size Query Hook
 *
 * How many products OpenLinker holds for this install, read as the `total` of
 * a one-row product list — the cheapest existing surface that answers it.
 *
 * It is deliberately reported as "what OpenLinker has replicated", not "what
 * the shop holds". Mid-first-sync those are different numbers, and the page
 * says so next to the figure. A `null` result means the question is
 * unanswered, and every cycle length then renders as unknown rather than
 * being computed from a guess.
 *
 * @module apps/web/src/features/settings/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { useSession } from '../../../shared/auth/use-session';

export function useCatalogueSizeQuery(): UseQueryResult<number | null> {
  const apiClient = useApiClient();
  const { session } = useSession();
  const isAdmin = session.status === 'authenticated' && session.user?.role === 'admin';

  return useQuery({
    queryKey: ['operational-settings', 'catalogue-size'],
    queryFn: async (): Promise<number | null> => {
      const page = await apiClient.products.list(undefined, { limit: 1, offset: 0 });
      return typeof page.total === 'number' && page.total > 0 ? page.total : null;
    },
    enabled: isAdmin,
    staleTime: 5 * 60 * 1000,
  });
}
