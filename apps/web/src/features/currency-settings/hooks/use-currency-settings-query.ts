/**
 * Currency Settings Query Hook
 *
 * Reads the reporting-currency settings view. Gated on admin role so a
 * non-admin session doesn't trigger a 403 round-trip — the tile isn't
 * rendered for them at all (see `settings-page.tsx`), but the hook stays
 * defensively gated to match the `posthog-settings` / `mailer-settings`
 * precedent.
 *
 * @module apps/web/src/features/currency-settings/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { useSession } from '../../../shared/auth/use-session';
import { currencySettingsQueryKeys } from '../api/currency-settings.query-keys';
import type { CurrencySettingsView } from '../api/currency-settings.types';

export function useCurrencySettingsQuery(): UseQueryResult<CurrencySettingsView> {
  const apiClient = useApiClient();
  const { session } = useSession();
  const isAdmin = session.status === 'authenticated' && session.user?.role === 'admin';

  return useQuery({
    queryKey: currencySettingsQueryKeys.current(),
    queryFn: () => apiClient.currencySettings.get(),
    enabled: isAdmin,
  });
}
