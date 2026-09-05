/**
 * `/bench` route placement (#2413)
 *
 * The pack bench's idle lock CLEARS the session on purpose — an overlay over a
 * live token is a curtain, not a lock (ADR-071's stated failure mode is
 * mis-attribution). `AuthenticatedAppLayout` answers an anonymous session with
 * `<Navigate to="/login" replace />`.
 *
 * Put together under `rootRoute`, those two are incompatible: the lock fires,
 * the layout navigates away, and the bench subtree unmounts — destroying the
 * packer's half-verified parcel and showing the generic login page instead of
 * the bench's own locked screen. That is stories **A2** ("verification progress
 * survives the switch") and **A3** ("locking never discards progress") defeated
 * at once, in production, with every component-level test still green: they
 * mount `BenchSurface` directly, with no router and no layout.
 *
 * So this file asserts the PLACEMENT rather than the behaviour, because
 * placement is the thing that was wrong and the thing a future refactor would
 * plausibly "tidy" back. It is deliberately structural: rendering the whole
 * router would need the system-config fetch and the shell, and would assert the
 * same fact far less directly.
 *
 * @module app/routes
 */
import { describe, expect, it } from 'vitest';

import { benchRoute } from './bench.route';
import { coreChildren } from './root.route';
import { guestRoutes, standaloneRoutes } from '../router';

function pathsOf(routes: readonly { path?: string }[]): (string | undefined)[] {
  return routes.map((route) => route.path);
}

describe('/bench route placement (#2413)', () => {
  it('is registered as a standalone top-level route', () => {
    expect(standaloneRoutes).toContain(benchRoute);
  });

  it('is NOT a child of rootRoute, whose layout would sign the packer out mid-parcel', () => {
    // The load-bearing assertion. See the module docblock: moving it back under
    // `rootRoute` re-creates the defect, and nothing else in the suite sees it.
    expect(coreChildren).not.toContain(benchRoute);
    expect(pathsOf(coreChildren)).not.toContain('bench');
    expect(pathsOf(coreChildren)).not.toContain('/bench');
  });

  it('is NOT a guest route', () => {
    // `guestRoutes` are anonymous entry points into the ordinary app, and the
    // contract tests over that array describe only those. The bench merely
    // TOLERATES an anonymous session, by rendering its own sign-in.
    expect(guestRoutes).not.toContain(benchRoute);
  });

  it('resolves a lazy component and carries a crumb', () => {
    expect(typeof benchRoute.lazy).toBe('function');
    expect(benchRoute.handle).toBeDefined();
  });
});
