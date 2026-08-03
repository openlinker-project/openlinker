import type { ReactElement } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useSession } from '../../shared/auth/use-session';
import { LoadingState } from '../../shared/ui/feedback-state';
import { AppShell } from '../app-shell';
import { PageLayout } from '../../shared/ui/page-layout';
import { useSystemConfigQuery } from '../../features/system';

export function AuthenticatedAppLayout(): ReactElement {
  const { isReady, session } = useSession();
  const location = useLocation();
  // Demo mode decides whether the consent gate below applies at all, so the
  // shell waits for this query to settle rather than reading a default of
  // `false` on first paint (#1938). Without the wait, a consent-less demo
  // account renders the app for a frame and fires the reads the API is about to
  // 403 — the gate has to be decided before any route mounts, not after.
  const systemConfigQuery = useSystemConfigQuery();
  const demoMode = systemConfigQuery.data?.demoMode ?? false;
  const isAuthenticated = isReady && session.status === 'authenticated';

  if (!isReady || (isAuthenticated && systemConfigQuery.isPending)) {
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

  // A demo account that has not consented to session recording gets no shell
  // and no route under it (#1938). Viewer-only: admin and operator accounts on
  // a demo instance are the operators' own, and gating them would block live
  // support — the same split the read-only demo banner uses. The API enforces
  // the same rule globally, so this redirect is the friendly face of a gate
  // that holds even if the browser is tampered with.
  if (demoMode && session.user?.role === 'viewer' && session.user.analyticsConsent !== true) {
    return (
      <Navigate
        to={{ pathname: '/consent', search: `?next=${encodeURIComponent(location.pathname)}` }}
        replace
      />
    );
  }

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
