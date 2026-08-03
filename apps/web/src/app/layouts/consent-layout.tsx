/**
 * Consent Layout
 *
 * Chrome for `/consent` (#1938): the guest-shaped centred card, but for an
 * *authenticated* session — `GuestLayout` would bounce an authenticated visitor
 * straight back to `/`, which is the opposite of what this route needs.
 *
 * Three states:
 *  - anonymous → `/login` (nothing to consent with),
 *  - already consented → back to `?next=` after re-minting the access token, so
 *    an account holding a token issued before the consent claim existed is
 *    healed silently instead of being asked again,
 *  - otherwise → render the gate.
 *
 * @module app/layouts
 */
import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';
import { Navigate, Outlet, useSearchParams } from 'react-router-dom';
import { useSession } from '../../shared/auth/use-session';
import { LoadingState } from '../../shared/ui/feedback-state';
import { resolveNextPath } from '../../features/demo';

export function ConsentLayout(): ReactElement {
  const { isReady, session, adapter, refreshSession } = useSession();
  const [searchParams] = useSearchParams();
  const [tokenRefreshed, setTokenRefreshed] = useState(false);
  const alreadyConsented = session.user?.analyticsConsent === true;

  // Consent is already on the account, so the only thing that can still be
  // stale is this browser's access token. Re-mint it, then fall through to the
  // redirect below.
  useEffect(() => {
    if (!isReady || session.status !== 'authenticated' || !alreadyConsented || tokenRefreshed) {
      return;
    }
    void (async (): Promise<void> => {
      await adapter.refresh?.();
      await refreshSession();
      setTokenRefreshed(true);
    })();
  }, [isReady, session.status, alreadyConsented, tokenRefreshed, adapter, refreshSession]);

  if (!isReady) {
    return (
      <div className="guest-layout">
        <LoadingState title="Loading" message="Checking session state..." />
      </div>
    );
  }

  if (session.status === 'anonymous') {
    return <Navigate to="/login" replace />;
  }

  if (alreadyConsented && tokenRefreshed) {
    return <Navigate to={resolveNextPath(searchParams.get('next'))} replace />;
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
