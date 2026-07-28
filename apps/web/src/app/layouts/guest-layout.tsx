import type { ReactElement } from 'react';
import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useSession } from '../../shared/auth/use-session';
import { LoadingState } from '../../shared/ui/feedback-state';
import { useSystemConfigQuery } from '../../features/system';
import { captureMarketingLanding } from '../../features/demo';

const MARKETING_CAPTURE_PATHS = ['/login', '/register'];

export function GuestLayout(): ReactElement {
  const { isReady, session } = useSession();
  const systemConfigQuery = useSystemConfigQuery();
  const location = useLocation();

  // Marketing UTM capture — mounted here (rather than per-page) so it fires
  // regardless of which of /login or /register a visitor actually lands on,
  // but deliberately scoped to only those two paths: that's where
  // `MarketingTrackingFootnote` discloses it, and `/forgot-password`,
  // `/reset-password/:token`, and `/confirm-email/:token` are excluded on
  // purpose — the latter two carry a single-use sensitive token as a path
  // segment, and `captureMarketingLanding` sends the full `window.location`
  // (including path) to PostHog, which would otherwise leak the token.
  // Also skipped once the session is authenticated, so a visitor who is
  // already signed in and about to be redirected away from /login never
  // gets captured.
  useEffect(() => {
    if (!systemConfigQuery.isSuccess) {
      return;
    }
    if (session.status === 'authenticated') {
      return;
    }
    if (!MARKETING_CAPTURE_PATHS.includes(location.pathname)) {
      return;
    }
    captureMarketingLanding(systemConfigQuery.data);
  }, [systemConfigQuery.isSuccess, systemConfigQuery.data, session.status, location.pathname]);

  if (!isReady) {
    return (
      <div className="guest-layout">
        <LoadingState title="Loading" message="Checking session state..." />
      </div>
    );
  }

  if (session.status === 'authenticated') {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="guest-layout">
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
