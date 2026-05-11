import { createBrowserRouter, type RouteObject } from 'react-router-dom';

import { forgotPasswordRoute } from './routes/forgot-password.route';
import { loginRoute } from './routes/login.route';
import { resetPasswordRoute } from './routes/reset-password.route';
import { rootRoute } from './routes/root.route';

/**
 * Guest routes — anonymous entry points. Exported solely so the route-lazy
 * test can iterate them alongside `coreChildren` and plugin routes; this is
 * NOT a runtime API for other modules to consume. The runtime composition
 * is the `appRouter` below.
 */
export const guestRoutes: RouteObject[] = [loginRoute, forgotPasswordRoute, resetPasswordRoute];

export const appRouter = createBrowserRouter([...guestRoutes, rootRoute]);
