import type { ReactElement } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { BENCH_PATH, resolveSessionSurface } from '../../shared/auth/session-surface';
import { useSession } from '../../shared/auth/use-session';
import { LoadingState } from '../../shared/ui/feedback-state';
import { AppShell } from '../app-shell';
import { PageLayout } from '../../shared/ui/page-layout';
import { useSystemConfigQuery } from '../../features/system';

/** The /login query string: the original params, plus `next` for a deep link. */
function loginSearch(location: { pathname: string; search: string }): string {
  if (location.pathname === '/') return location.search;
  const params = new URLSearchParams(location.search);
  params.set('next', `${location.pathname}${location.search}`);
  return `?${params.toString()}`;
}

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

  // #3096 (F-9) — a bench-only session (a packer) never renders this shell,
  // not even the `@AnyRole()` reads #3221's nav gate leaves reachable (the
  // #3221 follow-up asked for exactly this, by role; this one check is it).
  // Decided BEFORE the loading branch below, because that branch already
  // renders `AppShell` — its sidebar would flash a packer the full admin
  // navigation while the system config loads. `/bench` sits outside this
  // layout (`bench.route.tsx`), so the redirect cannot loop, and because every
  // core and plugin route is a child of this layout, this one check closes all
  // of them without a list of allowed paths.
  //
  // Except a packer still owing a password change (#3456): the API refuses
  // every route but the change itself, the bench included, so the
  // change-password redirect below must win.
  if (
    resolveSessionSurface(isReady, session) === 'bench-only' &&
    session.user?.mustChangePassword !== true
  ) {
    return <Navigate to={BENCH_PATH} replace />;
  }

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
    // being silently dropped by the redirect. A deep link below the root also
    // rides along as `?next=` (#3096), so signing in returns the operator to
    // the order or task they were opening rather than to Analytics; the guest
    // layout sanitises it through `resolveNextPath`.
    return <Navigate to={{ pathname: '/login', search: loginSearch(location) }} replace />;
  }

  // An account created by an admin with a one-time password must replace it
  // before anything else (#3456). Checked BEFORE the consent gate: consent is a
  // legally meaningful act and must be attributable to the account holder, not
  // performable while a credential a second party has read is still live. The
  // API's `PasswordChangeRequiredGuard` refuses every other route regardless.
  if (session.user?.mustChangePassword === true) {
    return (
      <Navigate
        to={{ pathname: '/change-password', search: `?next=${encodeURIComponent(location.pathname)}` }}
        replace
      />
    );
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
