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
import { Navigate, useSearchParams } from 'react-router-dom';
import { useSession } from '../../shared/auth/use-session';
import { LoadingState } from '../../shared/ui/feedback-state';
import { resolveNextPath } from '../../shared/lib/resolve-next-path';
import { LoginStageScreen } from './login-stage-layout';
import { useMessages } from '../../shared/i18n';

export function ConsentLayout(): ReactElement {
  const copy = useMessages('app');
  const { isReady, session, adapter, refreshSession } = useSession();
  const [searchParams] = useSearchParams();
  const [tokenRefreshed, setTokenRefreshed] = useState(false);
  const alreadyConsented = session.user?.analyticsConsent === true;
  // #4029 - consent accepted ON this screen plays its own "signed in" step and
  // navigates itself; only an account that ARRIVED consented is bounced here.
  // Decided once, at the first READY render (before it, `session.user` is unknown).
  const [arrivedConsentedState, setArrivedConsented] = useState<boolean | null>(null);
  if (isReady && arrivedConsentedState === null) setArrivedConsented(alreadyConsented);
  const arrivedConsented = arrivedConsentedState ?? alreadyConsented;

  // Consent is already on the account, so the only thing that can still be
  // stale is this browser's access token. Re-mint it, then fall through to the
  // redirect below.
  useEffect(() => {
    if (
      !isReady ||
      session.status !== 'authenticated' ||
      !alreadyConsented ||
      !arrivedConsented ||
      tokenRefreshed
    ) {
      return;
    }
    void (async (): Promise<void> => {
      await adapter.refresh?.();
      await refreshSession();
      setTokenRefreshed(true);
    })();
  }, [
    isReady,
    session.status,
    alreadyConsented,
    arrivedConsented,
    tokenRefreshed,
    adapter,
    refreshSession,
  ]);

  if (!isReady) {
    return (
      <div className="guest-layout guest-layout--pending">
        <LoadingState title={copy.loading.loading} message={copy.loading.checkingSession} />
      </div>
    );
  }

  if (session.status === 'anonymous') {
    return <Navigate to="/login" replace />;
  }

  if (arrivedConsented && alreadyConsented && tokenRefreshed) {
    return <Navigate to={resolveNextPath(searchParams.get('next'))} replace />;
  }

  return <LoginStageScreen mode="consent" />;
}
