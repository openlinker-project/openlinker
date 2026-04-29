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
import { Alert } from '../../shared/ui/alert';
import { Button } from '../../shared/ui/button';
import { ErrorState, LoadingState } from '../../shared/ui/feedback-state';
import { PageLayout } from '../../shared/ui/page-layout';
import { AiProviderTable } from '../../features/ai-provider-settings/components/ai-provider-table';
import { useAiProviderSettingsQuery } from '../../features/ai-provider-settings/hooks/use-ai-provider-settings-query';

export function AiProviderSettingsPage(): ReactElement {
  const { session } = useSession();
  const query = useAiProviderSettingsQuery();

  if (session.status === 'authenticated' && session.user?.role !== 'admin') {
    return (
      <PageLayout
        eyebrow="AI"
        title="Provider settings"
        description="Admin-only access."
      >
        <ErrorState
          title="Admin role required"
          message="This page manages AI provider keys and routing — it requires an admin session."
        />
      </PageLayout>
    );
  }

  return (
    <PageLayout
      eyebrow="AI"
      title="Provider settings"
      description="Manage per-provider API keys and switch the active provider that handles AI requests."
    >
      {query.isPending ? (
        <LoadingState
          title="Loading provider settings"
          message="Reading current key resolution status…"
        />
      ) : query.error ? (
        <ErrorState
          title="Unable to load provider settings"
          message={query.error instanceof Error ? query.error.message : 'Unknown error'}
          action={
            <Button tone="secondary" onClick={() => void query.refetch()}>
              Retry
            </Button>
          }
        />
      ) : query.data ? (
        <>
          {!hasAnyKeyConfigured(query.data.providers) ? (
            <Alert tone="warning" title="No AI provider configured">
              AI suggestions will fail until a key is saved and a provider is activated. The
              active provider falls back to <span className="mono-text">OL_AI_PROVIDER</span>{' '}
              on first boot when no DB row exists.
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
