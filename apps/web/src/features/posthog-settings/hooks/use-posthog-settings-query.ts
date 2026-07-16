/**
 * PostHog Settings Query Hook
 *
 * Reads the PostHog analytics settings view. Gated on admin role so
 * non-admin sessions don't trigger a 403 round-trip — the tile isn't
 * rendered for them at all (see `settings-page.tsx`), but the hook stays
 * defensively gated to match the `mailer-settings` precedent.
 *
 * @module apps/web/src/features/posthog-settings/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { useSession } from '../../../shared/auth/use-session';
import { posthogSettingsQueryKeys } from '../api/posthog-settings.query-keys';
import type { PosthogSettingsView } from '../api/posthog-settings.types';

export function usePosthogSettingsQuery(): UseQueryResult<PosthogSettingsView> {
  const apiClient = useApiClient();
  const { session } = useSession();
  const isAdmin = session.status === 'authenticated' && session.user?.role === 'admin';

  return useQuery({
    queryKey: posthogSettingsQueryKeys.current(),
    queryFn: () => apiClient.posthogSettings.get(),
    enabled: isAdmin,
  });
}
