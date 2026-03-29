import type { ReactElement } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useSession } from '../../shared/auth/use-session';
import { LoadingState } from '../../shared/ui/feedback-state';
import { AppShell } from '../../shared/ui/app-shell';
import { PageLayout } from '../../shared/ui/page-layout';

export function AuthenticatedAppLayout(): ReactElement {
  const { isReady, session } = useSession();

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
    return <Navigate to="/login" replace />;
  }

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
