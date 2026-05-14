/**
 * Route handle contract test
 *
 * Iterates every authenticated route registered with the host (core children
 * of `rootRoute` plus every plugin's contributed routes) and asserts each
 * leaf carries a crumb-shaped `handle`. Parameterized so a copy-paste
 * regression on any single file fails this test — mirrors the
 * `route-lazy.test.ts` pattern.
 *
 * Guest routes (`login`, `forgot-password`, `reset-password`) render outside
 * `AuthenticatedAppLayout` / `AppShell`, so `useMatches()` inside the shell
 * never sees them — they are intentionally excluded.
 *
 * Legacy-redirect routes that render an inline `<Navigate>` element with
 * neither `lazy` nor `children` are transient (the user is redirected before
 * the shell renders a crumb) and are also excluded.
 *
 * @module app/routes
 * @see ../breadcrumbs.ts — `resolveCrumbFromMatches` consumes `handle.crumb`
 * @see ../nav-registry.types.ts — `RouteCrumbHandle` shape + `isCrumbHandle`
 */
import type { RouteObject } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { plugins } from '../../plugins';
import { isCrumbHandle } from '../nav-registry.types';
import { coreChildren } from './root.route';

/**
 * Walk the route tree depth-first and collect every **lazy** leaf node —
 * defined as a node that renders content via `lazy: () => …` and has no
 * `children` of its own (so the deepest match really is this row). The
 * `lazy` check is load-bearing: it intentionally skips
 *
 *   - `<Navigate>`-element legacy redirects (no `lazy`, only `element`);
 *   - eager-element guest routes like `loginRoute` (not in `coreChildren`
 *     anyway, but defensive).
 *
 * Every authenticated page module is lazy today (#606). If a future
 * authenticated route lands as eager `element:`, broaden this filter to
 * `route.lazy === 'function' || route.element !== undefined` so it still
 * gets crumb-contract coverage.
 */
function collectLazyAuthenticatedLeafRoutes(routes: RouteObject[]): RouteObject[] {
  const out: RouteObject[] = [];
  for (const route of routes) {
    if (route.children && route.children.length > 0) {
      out.push(...collectLazyAuthenticatedLeafRoutes(route.children));
      continue;
    }
    if (typeof route.lazy === 'function') {
      out.push(route);
    }
  }
  return out;
}

const leafRoutes = collectLazyAuthenticatedLeafRoutes([
  ...coreChildren,
  ...plugins.flatMap((plugin) => plugin.build?.routes ?? []),
]);

describe('route handle contract', () => {
  it('every authenticated leaf route is discoverable', () => {
    // Sanity check: the contract test only fires if we actually picked up
    // routes. A regression that returns an empty array (e.g. changed route
    // tree shape) should fail loudly here rather than silently pass.
    expect(leafRoutes.length).toBeGreaterThan(0);
  });

  it.each(
    leafRoutes.map((route) => [describePath(route), route] as const),
  )('route %s declares a crumb-shaped handle', (_label, route) => {
    expect(isCrumbHandle(route.handle)).toBe(true);
  });
});

function describePath(route: RouteObject): string {
  if (route.index === true) return '<index>';
  return route.path ?? '<unknown>';
}
