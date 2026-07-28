import type { ReactElement } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useSession } from '../../shared/auth/use-session';
import { LoadingState } from '../../shared/ui/feedback-state';
import { AppShell } from '../app-shell';
import { PageLayout } from '../../shared/ui/page-layout';

export function AuthenticatedAppLayout(): ReactElement {
  const { isReady, session } = useSession();
  const location = useLocation();

  if (!isReady) {
    return (
      <AppShell>
        <PageLayout
          eyebrow="Session"
          title="Preparing workspace"
          description="Loading session and environment context before rendering operator routes."
        >
          <LoadingState
            title="Loading application shell"
            message="Checking the current session state and workspace metadata."
          />
        </PageLayout>
      </AppShell>
    );
  }

  if (session.status === 'anonymous') {
    // Preserve the query string (e.g. utm_* campaign params from a marketing
    // redirect landing on the app root) so it survives onto /login instead of
    // being silently dropped by the redirect.
    return <Navigate to={{ pathname: '/login', search: location.search }} replace />;
  }

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
