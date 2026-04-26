/**
 * AI Provider Settings Query Hook
 *
 * Reads the current key-resolution status (provider, configured, source).
 * Gated on admin role so non-admin sessions don't trigger a 403 round-trip
 * — the page renders an `ErrorState` for them anyway.
 *
 * @module apps/web/src/features/ai-provider-settings/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { useSession } from '../../../shared/auth/use-session';
import { aiProviderSettingsQueryKeys } from '../api/ai-provider-settings.query-keys';
import type { AiProviderSettingsView } from '../api/ai-provider-settings.types';

export function useAiProviderSettingsQuery(): UseQueryResult<AiProviderSettingsView> {
  const apiClient = useApiClient();
  const { session } = useSession();
  const isAdmin =
    session.status === 'authenticated' && session.user?.role === 'admin';

  return useQuery({
    queryKey: aiProviderSettingsQueryKeys.current(),
    queryFn: () => apiClient.aiProviderSettings.get(),
    enabled: isAdmin,
  });
}
