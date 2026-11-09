/**
 * Route: `/login` and `/register` — anonymous entry points (#4029).
 *
 * Both paths share ONE pathless layout route, so switching between the
 * sign-in and sign-up tabs changes the URL without remounting the screen:
 * the card animates in place instead of the page being rebuilt. The layout
 * renders everything; the two children only carry the paths.
 *
 * Kept eager (not lazy): this is the first paint for every unauthenticated
 * cold visit (`/` redirects here), and a lazy chunk fetch adds a blank-screen
 * window to the most common first impression. Forgot/reset stay lazy.
 *
 * @module app/routes
 */
import type { RouteObject } from 'react-router-dom';

import { LoginStageLayout } from '../layouts/login-stage-layout';

export const loginRoute: RouteObject = {
  element: <LoginStageLayout />,
  children: [{ path: '/login' }, { path: '/register' }],
};
