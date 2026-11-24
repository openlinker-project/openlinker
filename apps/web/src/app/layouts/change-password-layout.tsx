/**
 * Change Password Layout
 *
 * Chrome for `/change-password` (#3456): the guest-shaped centred card for an
 * *authenticated* session, like `ConsentLayout` - `GuestLayout` would bounce an
 * authenticated visitor straight back to `/`.
 *
 * Three states:
 *  - anonymous → `/login` (nothing to change),
 *  - no change owed (already replaced it, or never forced) → straight to `next`,
 *  - otherwise → render the form.
 *
 * @module app/layouts
 */
import type { ReactElement } from 'react';
import { Navigate, Outlet, useSearchParams } from 'react-router-dom';
import { useSession } from '../../shared/auth/use-session';
import { LoadingState } from '../../shared/ui/feedback-state';
import { useMessages } from '../../shared/i18n';
import { resolveNextPath } from '../../shared/lib/resolve-next-path';

export function ChangePasswordLayout(): ReactElement {
  const copy = useMessages('app');
  const { isReady, session } = useSession();
  const [searchParams] = useSearchParams();

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

  if (session.user?.mustChangePassword !== true) {
    return <Navigate to={resolveNextPath(searchParams.get('next'))} replace />;
  }

  return (
    <div className="guest-layout">
      <div className="guest-card">
        <div className="guest-brand">
          <strong className="guest-brand__title">{copy.brand.name}</strong>
          <span className="guest-brand__subtitle">{copy.brand.tagline}</span>
        </div>
        <Outlet />
      </div>
    </div>
  );
}
