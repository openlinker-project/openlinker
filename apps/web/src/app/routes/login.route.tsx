/**
 * Route: `/login` — anonymous entry point.
 *
 * Login is intentionally kept eager (not lazy) because it's the first paint
 * for every unauthenticated cold visit: `/` → root redirects to `/login` →
 * login renders. A lazy chunk fetch there adds a blank-screen window for
 * the most-common first impression and conflicts with the
 * `docs/frontend-ui-style-guide.md` §Product Feel direction. Forgot/reset
 * routes stay lazy — they're rarely hit.
 *
 * @module app/routes
 */
import type { RouteObject } from 'react-router-dom';

import { LoginPage } from '../../pages/auth/LoginPage';
import { GuestLayout } from '../layouts/guest-layout';

export const loginRoute: RouteObject = {
  path: '/login',
  element: <GuestLayout />,
  children: [{ index: true, element: <LoginPage /> }],
};
