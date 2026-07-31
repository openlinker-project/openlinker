/**
 * Route: `/consent` — session-recording consent gate for a demo account (#1938).
 *
 * A top-level route, deliberately outside `rootRoute`, so it renders without
 * `AppShell`: no sidebar, no nav, nothing to click past. `AuthenticatedAppLayout`
 * redirects a consent-less demo viewer here, and the API's global
 * `AnalyticsConsentGuard` refuses every other route in the meantime.
 *
 * Kept eager rather than lazy: `features/demo` is already in the entry bundle
 * (the app shell and the guest layout both import it), so a chunk boundary here
 * would buy nothing and add a blank frame to a redirect the visitor did not ask
 * for.
 *
 * @module app/routes
 */
import type { RouteObject } from 'react-router-dom';

import { ConsentGate } from '../../features/demo';
import { ConsentLayout } from '../layouts/consent-layout';

export const consentRoute: RouteObject = {
  path: '/consent',
  element: <ConsentLayout />,
  children: [{ index: true, element: <ConsentGate /> }],
};
