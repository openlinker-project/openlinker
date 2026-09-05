/**
 * Pack bench route (#2413)
 *
 * `/bench` — Surface A of the pack bench.
 *
 * ## A TOP-LEVEL route, deliberately outside `AuthenticatedAppLayout`
 *
 * That layout redirects to `/login` the moment the session goes anonymous, and
 * the bench's idle lock CLEARS the session on purpose — an overlay over a live
 * token is a curtain, not a lock. Registered as a child of `rootRoute` the two
 * would fight: the lock would fire, the layout would navigate away, and the
 * bench subtree would unmount, taking the packer's half-verified parcel with it
 * and showing the generic login page instead of the bench's own locked screen.
 * That is both A2 ("progress survives the switch") and A3 ("locking never
 * discards progress") defeated at once, and it is invisible to any test that
 * mounts the bench without the router.
 *
 * So it sits in `standaloneRoutes`, beside `/consent` — no `AppShell`, no
 * sidebar, and no authenticated-layout gate. The bench renders its own
 * sign-in, so an anonymous session is a state it handles rather than a state it
 * must be rescued from. A full-screen terminal wants no application chrome
 * anyway.
 *
 * It carries a crumb because the shell's crumb contract is cheap to satisfy and
 * the surface may later be reachable from one; nothing renders it today.
 *
 * ## No nav entry
 *
 * A packer opens this at a terminal by URL. #2416 revisits that when the bench
 * has work to show — a nav entry would also need `RoleValues` widened, since it
 * is `['admin','operator']` today.
 *
 * @module app/routes
 */
import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

const benchCrumb: RouteCrumbHandle = {
  crumb: { group: 'Operations', title: 'Pack bench' },
};

export const benchRoute: RouteObject = {
  path: '/bench',
  handle: benchCrumb,
  lazy: async () => {
    const { BenchPage } = await import('../../pages/bench/bench-page');
    return { Component: BenchPage };
  },
};
