import type { ReactElement } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useSession } from '../../shared/auth/use-session';
import { LoadingState } from '../../shared/ui/feedback-state';

export function GuestLayout(): ReactElement {
  const { isReady, session } = useSession();

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
