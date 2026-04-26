/**
 * AI Provider Settings Page
 *
 * Admin-only page for viewing and updating the AI provider's API key.
 * Backed by the BE endpoints shipped in #402. The page composes the
 * status card and the form; the query hook is gated on `isAdmin` so
 * non-admin sessions never trigger a 403 round-trip.
 *
 * @module apps/web/src/pages/ai-provider-settings
 */
import type { ReactElement } from 'react';
import { useSession } from '../../shared/auth/use-session';
import { Alert } from '../../shared/ui/alert';
import { Button } from '../../shared/ui/button';
import { ErrorState, LoadingState } from '../../shared/ui/feedback-state';
import { PageLayout } from '../../shared/ui/page-layout';
import { AiProviderSettingsForm } from '../../features/ai-provider-settings/components/ai-provider-settings-form';
import { AiProviderStatusCard } from '../../features/ai-provider-settings/components/ai-provider-status-card';
import { useAiProviderSettingsQuery } from '../../features/ai-provider-settings/hooks/use-ai-provider-settings-query';

export function AiProviderSettingsPage(): ReactElement {
  const { session } = useSession();
  const query = useAiProviderSettingsQuery();

  // Admin gate before rendering the data surface. Mirrors the prompt-templates
  // page's pattern; the query hook is `enabled: isAdmin` so non-admins never
  // hit the network.
  if (session.status === 'authenticated' && session.user?.role !== 'admin') {
    return (
      <PageLayout
        eyebrow="AI"
        title="Provider settings"
        description="Admin-only access."
      >
        <ErrorState
          title="Admin role required"
          message="This page manages the AI provider API key and requires an admin session."
        />
      </PageLayout>
    );
  }

  return (
    <PageLayout
      eyebrow="AI"
      title="Provider settings"
      description="Configure the encrypted API key the server uses to talk to the active AI provider."
    >
      {/*
        Use `isPending` (no data yet) instead of `isLoading` so the LoadingState
        also covers the gap between "session still resolving" (enabled=false) and
        "session resolved + query in flight" (enabled=true, fetching). Without
        this, the initial render with `enabled: isAdmin` flickers to an empty
        viewport while the session adapter resolves.
      */}
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
          <AiProviderStatusCard view={query.data} />
          {query.data.provider === 'fake' ? (
            <Alert tone="info" title="Fake provider active">
              The active AI provider does not require an API key. Set
              <span className="mono-text"> OL_AI_PROVIDER=anthropic </span>
              on the server and restart the API to enable the form below.
            </Alert>
          ) : (
            <AiProviderSettingsForm currentSource={query.data.source} />
          )}
        </>
      ) : null}
    </PageLayout>
  );
}
