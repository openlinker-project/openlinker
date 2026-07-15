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
  ...plugins.flatMap((plugin) => plugin.build?.routes ?? []),
]);

/**
 * Expected count of lazy-loaded route nodes after walking the entire tree.
 *
 * **Bump this when intentionally adding or removing a lazy route.** The exact
 * equality is deliberate: a `>= N` lower bound would silently miss a single
 * route reverted to eager `element:` form, which is exactly the regression
 * the parameterized test below is meant to catch.
 *
 * Today's breakdown (47 total):
 *   - 34 authenticated children (under `coreChildren`, counting per-children-node
 *     because grouped routes like orders/customers expose multiple lazy nodes —
 *     includes `/dev/ui` design-system page (#775), `/shipments` (#770),
 *     `/users` user-management page (#1125), and `/invoices/:invoiceId` detail (#1240))
 *   - 3 guest routes (forgot-password, reset-password, register — login stays eager)
 *   - 10 plugin routes (allegro callback + setup, prestashop setup, dpd setup,
 *     woocommerce setup, erli setup, subiekt setup (#1199), ksef setup, inpost setup,
 *     infakt setup (#1282))
 *
 * Routes that are intentionally eager (no page module to defer):
 *   - login (first-paint optimization — see `login.route.tsx`)
 *   - prompt-templates-legacy-redirects (inline `<Navigate>` element)
 */
const EXPECTED_LAZY_ROUTE_COUNT = 47;

describe('route lazy contract', () => {
  it(`the registered route tree contains exactly ${EXPECTED_LAZY_ROUTE_COUNT} lazy routes`, () => {
    // Exact equality, not a lower bound: any single regression from `lazy`
    // back to eager `element` shifts the count down by one and fails here.
    expect(lazyRoutes.length).toBe(EXPECTED_LAZY_ROUTE_COUNT);
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
