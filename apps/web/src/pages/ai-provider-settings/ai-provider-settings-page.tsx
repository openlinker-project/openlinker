/**
 * AI Provider Settings Page
 *
 * Admin-only page for managing per-provider AI keys and switching the
 * active provider. Renders a provider table; row actions open dialogs for
 * key set/rotate, key clear, and active-provider switch. The query hook
 * is gated on `isAdmin` so non-admin sessions never trigger a 403
 * round-trip.
 *
 * @module apps/web/src/pages/ai-provider-settings
 */
import type { ReactElement } from 'react';
import { useSession } from '../../shared/auth/use-session';
import { useMessages } from '../../shared/i18n';
import { Alert } from '../../shared/ui/alert';
import { Button } from '../../shared/ui/button';
import { ErrorState, LoadingState } from '../../shared/ui/feedback-state';
import { PageLayout } from '../../shared/ui/page-layout';
import { AiProviderTable } from '../../features/ai-provider-settings/components/ai-provider-table';
import { useAiProviderSettingsQuery } from '../../features/ai-provider-settings/hooks/use-ai-provider-settings-query';

export function AiProviderSettingsPage(): ReactElement {
  const copy = useMessages('ai-provider-settings').aiProviderSettingsPage;
  const { session } = useSession();
  const query = useAiProviderSettingsQuery();

  if (session.status === 'authenticated' && session.user?.role !== 'admin') {
    return (
      <PageLayout eyebrow={copy.eyebrow} title={copy.title} description={copy.adminOnly}>
        <ErrorState title={copy.adminRequiredTitle} message={copy.adminRequiredMessage} />
      </PageLayout>
    );
  }

  return (
    <PageLayout
      eyebrow={copy.eyebrow}
      title={copy.title}
      description={copy.description}
    >
      {query.isPending ? (
        <LoadingState title={copy.loadingTitle} message={copy.loadingMessage} />
      ) : query.error ? (
        <ErrorState
          title={copy.errorTitle}
          message={query.error instanceof Error ? query.error.message : copy.unknownError}
          action={
            <Button tone="secondary" onClick={() => void query.refetch()}>
              {copy.retry}
            </Button>
          }
        />
      ) : query.data ? (
        <>
          {!hasAnyKeyConfigured(query.data.providers) ? (
            <Alert tone="warning" title={copy.noProviderTitle}>
              {copy.noProviderBody}
            </Alert>
          ) : null}
          <AiProviderTable view={query.data} />
        </>
      ) : null}
    </PageLayout>
  );
}

function hasAnyKeyConfigured(
  providers: { provider: string; configured: boolean }[],
): boolean {
  return providers.some((p) => p.provider !== 'fake' && p.configured);
}
