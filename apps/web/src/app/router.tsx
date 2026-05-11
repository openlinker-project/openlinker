import { createBrowserRouter, type RouteObject } from 'react-router-dom';

import { forgotPasswordRoute } from './routes/forgot-password.route';
import { loginRoute } from './routes/login.route';
import { resetPasswordRoute } from './routes/reset-password.route';
import { rootRoute } from './routes/root.route';

/**
 * Guest routes — anonymous entry points. Exported so the route-lazy test
 * can iterate them alongside `coreChildren` and plugin routes; the test
 * needs the static reference, not the assembled `appRouter`.
 */
export const guestRoutes: RouteObject[] = [loginRoute, forgotPasswordRoute, resetPasswordRoute];

export const appRouter = createBrowserRouter([...guestRoutes, rootRoute]);
