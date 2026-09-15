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
 * ## There IS a nav entry now, and it points one way only
 *
 * `Pack bench` sits in the Operations group (#3108), gated
 * `requiresRole: ['admin', 'operator', 'packer']` — the same three roles every
 * `@Roles(...)` on the bench controllers admits. A packer no longer has to be
 * handed a URL.
 *
 * What has NOT changed is the direction: the entry points AT the bench and the
 * bench still links nowhere. The sidebar is not rendered here (this route is
 * outside `AppShell`, for the reason above), so there is nothing to click back
 * through — and that is deliberate rather than incidental, because the idle
 * lock clears the session and any link into the rest of the app would answer
 * that by bouncing a half-verified parcel to `/login`.
 *
 * This section previously read "No nav entry … #2416 revisits that … a nav
 * entry would also need `RoleValues` widened, since it is `['admin','operator']`
 * today." All three clauses are now false: there is an entry, #2416 closed
 * (2026-09-05) without adding one — its ACs were about the bench SURFACE
 * carrying no global nav, not about pointing at it, which is a distinction a
 * reader would not recover from a closed issue — and `RoleValues` was widened
 * by #3107. Corrected here rather than left for a future reader to chase,
 * because this is the file someone opens to ask why the bench is not in the
 * nav (`docs/frontend-architecture.md` § UX Mockups: a stale note is worse than
 * none, because it actively misleads).
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
