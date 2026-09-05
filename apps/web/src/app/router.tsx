import { createBrowserRouter, type RouteObject } from 'react-router-dom';

import { benchRoute } from './routes/bench.route';
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
/**
 * Standalone authenticated-ish surfaces that render OUTSIDE `AppShell` and
 * outside `AuthenticatedAppLayout`.
 *
 * `/bench` (#2413) is here for a load-bearing reason, not for layout taste.
 * `AuthenticatedAppLayout` redirects to `/login` the moment the session goes
 * anonymous — and the pack bench's idle lock CLEARS the session deliberately
 * (an overlay over a live token is a curtain, not a lock). Under that layout
 * the redirect would unmount the whole bench subtree, destroying the packer's
 * half-verified parcel and rendering the generic login page instead of the
 * bench's own locked screen: exactly the two failures stories A2 and A3
 * forbid. The bench owns its own sign-in, so it tolerates an anonymous
 * session by design.
 *
 * It is NOT a guest route: `guestRoutes` are anonymous entry points into the
 * ordinary app, and the contract tests over that array describe only those.
 *
 * Exported so `route-lazy.test.ts` can iterate these alongside the other
 * three groups; not a runtime API.
 */
export const standaloneRoutes: RouteObject[] = [consentRoute, benchRoute];

export const appRouter = createBrowserRouter([...guestRoutes, ...standaloneRoutes, rootRoute]);
