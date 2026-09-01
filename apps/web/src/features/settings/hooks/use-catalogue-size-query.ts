/**
 * Catalogue Size Query Hook
 *
 * How many products OpenLinker holds for this install, read as the `total` of
 * a one-row product list — the cheapest existing surface that answers it.
 *
 * It is deliberately reported as "what OpenLinker has replicated", not "what
 * the shop holds". Mid-first-sync those are different numbers, and every
 * surface that DERIVES from this figure has to say so - not just the figure
 * itself. The catalogue sweep enumerates the SHOP's catalogue, so a pass length
 * computed from this number is a floor, and mid-first-sync it can understate by
 * an order of magnitude or more (#2627 review). A `null` result means the
 * question is unanswered, and every cycle length then renders as unknown rather
 * than being computed from a guess.
 *
 * `stockPassDays` and `deletionWindowDays` are exempt from that caveat: those
 * sweeps really do enumerate OpenLinker's own mappings, so this IS their input.
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
