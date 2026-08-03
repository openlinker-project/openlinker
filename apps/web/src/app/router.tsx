import { createBrowserRouter, type RouteObject } from 'react-router-dom';

import { confirmEmailRoute } from './routes/confirm-email.route';
import { consentRoute } from './routes/consent.route';
import { forgotPasswordRoute } from './routes/forgot-password.route';
import { loginRoute } from './routes/login.route';
import { registerRoute } from './routes/register.route';
import { resetPasswordRoute } from './routes/reset-password.route';
import { rootRoute } from './routes/root.route';

/**
 * Guest routes — anonymous entry points. Exported solely so the route-lazy
 * test can iterate them alongside `coreChildren` and plugin routes; this is
 * NOT a runtime API for other modules to consume. The runtime composition
 * is the `appRouter` below.
 */
export const guestRoutes: RouteObject[] = [
  loginRoute,
  registerRoute,
  forgotPasswordRoute,
  resetPasswordRoute,
  confirmEmailRoute,
];

/**
 * `/consent` (#1938) sits at the top level next to the guest routes so it
 * renders without `AppShell`, but it is NOT a guest route — it requires an
 * authenticated session, and `ConsentLayout` sends an anonymous visitor to
 * `/login`. Kept out of `guestRoutes` so the guest-route contract tests keep
 * describing only anonymous entry points.
 */
export const appRouter = createBrowserRouter([...guestRoutes, consentRoute, rootRoute]);
