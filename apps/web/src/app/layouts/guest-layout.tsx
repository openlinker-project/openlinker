import type { ReactElement } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { BENCH_PATH, resolveSessionSurface } from '../../shared/auth/session-surface';
import { useSession } from '../../shared/auth/use-session';
import { resolveNextPath } from '../../shared/lib/resolve-next-path';
import { LoadingState } from '../../shared/ui/feedback-state';
import { LanguageSwitch } from '../../features/language';

export function GuestLayout(): ReactElement {
  const { isReady, session } = useSession();
  const location = useLocation();

  if (!isReady) {
    return (
      <div className="guest-layout">
        <LoadingState title="Loading" message="Checking session state..." />
      </div>
    );
  }

  if (session.status === 'authenticated') {
    // #3096 (F-9): a bench-only session goes straight to the bench — never via
    // `/`, which would flash Analytics before the app layout bounced it — and
    // ignores `next`, because no app address is one it may open. Everyone else
    // returns to the deep link they were sent away from, sanitised so `next`
    // can never become an open redirect.
    const target =
      resolveSessionSurface(isReady, session) === 'bench-only'
        ? BENCH_PATH
        : resolveNextPath(new URLSearchParams(location.search).get('next'));
    return <Navigate to={target} replace />;
  }

  return (
    <div className="guest-layout">
      <div className="guest-layout__language">
        <LanguageSwitch placement="down" />
      </div>
      <div className="guest-card">
        <div className="guest-brand">
          <strong className="guest-brand__title">OpenLinker</strong>
          <span className="guest-brand__subtitle">Commerce operations platform</span>
        </div>
        <Outlet />
      </div>
    </div>
  );
}
