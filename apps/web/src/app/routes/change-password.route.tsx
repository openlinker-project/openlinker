/**
 * Route: `/change-password` - forced first-sign-in password change (#3456).
 *
 * A top-level route outside `rootRoute` (no `AppShell`, nothing to click past),
 * the `/consent` shape. `AuthenticatedAppLayout` redirects an account that still
 * owes a change here, and the API's global `PasswordChangeRequiredGuard` refuses
 * every other route in the meantime. Kept eager for the consent route's reason:
 * it is a redirect the visitor did not ask for.
 *
 * @module app/routes
 */
import type { ReactElement } from 'react';
import type { RouteObject } from 'react-router-dom';
import { useSearchParams } from 'react-router-dom';

import { ChangePasswordForm } from '../../features/auth';
import { resolveNextPath } from '../../shared/lib/resolve-next-path';
import { ChangePasswordLayout } from '../layouts/change-password-layout';

function ChangePasswordPage(): ReactElement {
  const [searchParams] = useSearchParams();
  return <ChangePasswordForm nextPath={resolveNextPath(searchParams.get('next'))} />;
}

export const changePasswordRoute: RouteObject = {
  path: '/change-password',
  element: <ChangePasswordLayout />,
  children: [{ index: true, element: <ChangePasswordPage /> }],
};
