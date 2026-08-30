/**
 * Operational Settings Query Hook
 *
 * Reads the resolved sweep values and deletion-audit cadence, each with the
 * rung that produced it. Gated on admin role so a non-admin session never
 * triggers a 403 round-trip — the page renders an `ErrorState` for them
 * anyway.
 *
 * @module apps/web/src/features/settings/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { useSession } from '../../../shared/auth/use-session';
import { operationalSettingsQueryKeys } from '../api/operational-settings.query-keys';
import type { OperationalSettingsView } from '../api/operational-settings.types';

export function useOperationalSettingsQuery(): UseQueryResult<OperationalSettingsView> {
  const apiClient = useApiClient();
  const { session } = useSession();
  const isAdmin = session.status === 'authenticated' && session.user?.role === 'admin';

  return useQuery({
    queryKey: operationalSettingsQueryKeys.current(),
    queryFn: () => apiClient.operationalSettings.get(),
    enabled: isAdmin,
  });
}
