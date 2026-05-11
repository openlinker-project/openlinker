/**
 * Route lazy contract test
 *
 * Iterates every route registered with the host (core children of `rootRoute`,
 * guest routes at the top level, plus every plugin's contributed routes) and
 * asserts that each one with a `lazy` field resolves to a `Component` or
 * `element`. Parameterized so a copy-paste regression in any single file
 * fails this test — the previous two-fixture form covered 2 of ~33 conversions.
 *
 * @module app/routes
 * @see docs/plans/implementation-plan-fe-lazy-route-registration.md
 */
import type { RouteObject } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { plugins } from '../../plugins';
import { guestRoutes } from '../router';
import { coreChildren } from './root.route';

/**
 * Walk the route tree depth-first and collect every node that defines a
 * `lazy` resolver. We can't just iterate top-level arrays because several
 * authenticated routes group children with their own page elements
 * (orders → list / failed / detail, customers → list / detail, …).
 */
function collectLazyRoutes(routes: RouteObject[]): RouteObject[] {
  const out: RouteObject[] = [];
  for (const route of routes) {
    if (typeof route.lazy === 'function') {
      out.push(route);
    }
    if (route.children && route.children.length > 0) {
      out.push(...collectLazyRoutes(route.children));
    }
  }
  return out;
}

const lazyRoutes = collectLazyRoutes([
  ...coreChildren,
  ...guestRoutes,
  ...plugins.flatMap((plugin) => plugin.routes ?? []),
]);

describe('route lazy contract', () => {
  it('the registered route tree contains at least 25 lazy routes', () => {
    // Sanity check: if this number drops sharply, someone reverted lazy
    // back to eager `element`. Today's count is ~33 across core + guest +
    // plugin. The lower bound is loose enough to absorb future additions
    // and the legacy-redirects file's eager routes (which are deliberately
    // not lazy — no page module to defer).
    expect(lazyRoutes.length).toBeGreaterThanOrEqual(25);
  });

  it.each(lazyRoutes.map((route, i) => [i, route] as const))(
    'lazy route [%i] resolves to a Component or element',
    async (_index, route) => {
      // `collectLazyRoutes` only includes routes whose `lazy` is a callable
      // function (vs the per-property object form RR v7 also supports), but
      // TS can't propagate that narrowing through the array; re-assert here.
      const resolver = route.lazy;
      if (typeof resolver !== 'function') {
        throw new Error('expected lazy to be a function-form resolver');
      }
      const result = await resolver();
      expect(result).toBeDefined();
      const hasComponentOrElement =
        ('Component' in result && result.Component !== undefined) ||
        ('element' in result && result.element !== undefined);
      expect(hasComponentOrElement).toBe(true);
    },
  );
});
