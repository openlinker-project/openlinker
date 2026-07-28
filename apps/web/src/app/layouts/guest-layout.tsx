import type { ReactElement } from 'react';
import { useEffect } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useSession } from '../../shared/auth/use-session';
import { LoadingState } from '../../shared/ui/feedback-state';
import { useSystemConfigQuery } from '../../features/system';
import { captureMarketingLanding } from '../../features/demo';

export function GuestLayout(): ReactElement {
  const { isReady, session } = useSession();
  const systemConfigQuery = useSystemConfigQuery();

  // Marketing UTM capture (#1900) — the single mount point for every guest
  // route (login, register, forgot/reset password), so it fires on whichever
  // one a visitor actually lands on. Deliberately NOT gated on session
  // readiness: it never reads session state and must fire even if the
  // visitor never signs in this tab.
  useEffect(() => {
    if (!systemConfigQuery.isSuccess) {
      return;
    }
    captureMarketingLanding(systemConfigQuery.data);
  }, [systemConfigQuery.isSuccess, systemConfigQuery.data]);

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
