/**
 * Mailer Settings Query Hook
 *
 * Reads the mailer/SMTP settings view. Gated on admin role so non-admin
 * sessions don't trigger a 403 round-trip — the tile isn't rendered for
 * them at all (see `settings-page.tsx`), but the hook stays defensively
 * gated to match the `ai-provider-settings` precedent.
 *
 * @module apps/web/src/features/mailer-settings/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { useSession } from '../../../shared/auth/use-session';
import { mailerSettingsQueryKeys } from '../api/mailer-settings.query-keys';
import type { MailerSettingsView } from '../api/mailer-settings.types';

export function useMailerSettingsQuery(): UseQueryResult<MailerSettingsView> {
  const apiClient = useApiClient();
  const { session } = useSession();
  const isAdmin = session.status === 'authenticated' && session.user?.role === 'admin';

  return useQuery({
    queryKey: mailerSettingsQueryKeys.current(),
    queryFn: () => apiClient.mailerSettings.get(),
    enabled: isAdmin,
  });
}
