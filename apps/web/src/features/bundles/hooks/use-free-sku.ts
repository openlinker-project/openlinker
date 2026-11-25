/**
 * A suggested bundle SKU that is known to be free (#4266).
 *
 * The model suggests a base ("KUBEK-x3"); this hook probes the catalogue and walks "-2", "-3"
 * until one has no owner, so a value known to collide is never pre-filled. While the probe is
 * running the base is returned, and the ordinary conflict check still guards what is typed.
 *
 * @module apps/web/src/features/bundles/hooks
 */
import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { findSkuConflict } from './use-sku-conflict';

const MAX_ATTEMPTS = 6;

export function useFreeSku(base: string, enabled: boolean): string {
  const apiClient = useApiClient();
  const query = useQuery({
    queryKey: ['bundles', 'free-sku', base.toLowerCase()],
    queryFn: async (): Promise<string> => {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        const candidate = attempt === 1 ? base : `${base}-${String(attempt)}`;
        try {
          if ((await findSkuConflict(apiClient, candidate)) === null) return candidate;
        } catch {
          // The probe is advice; the conflict check on the typed value still decides.
          return candidate;
        }
      }
      return base;
    },
    enabled: enabled && base.length >= 2,
    staleTime: 15_000,
  });
  return query.data ?? base;
}
