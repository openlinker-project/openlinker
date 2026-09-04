/**
 * Pack bench (#2413 Surface A, #2416 Surfaces B and C; spec §§ 2.1–2.3)
 *
 * Who is signed in, the idle lock and the handover (#2413), wrapped around the
 * work waiting at the bench (#2416).
 *
 * ## The list is the CHILD of `BenchSurface`, and that placement is the feature
 *
 * `BenchSurface` never unmounts its children, which is how *"locking never
 * discards progress"* (A3) and *"verification progress survives the switch"*
 * (A2) hold. Rendering the list beside the surface rather than inside it, or
 * behind a route change, would forfeit both — and would do so invisibly, since
 * every component test mounts these pieces directly.
 *
 * ## `/bench` stays OUTSIDE `AuthenticatedAppLayout`
 *
 * Unchanged from #2413 and load-bearing: the idle lock clears the session on
 * purpose, and that layout answers an anonymous session by navigating to
 * `/login` — which would unmount the bench mid-parcel. `bench-route-placement.test.ts`
 * pins it. Nothing here moves it, and adding the list gave no reason to.
 *
 * ## No frontend role gate, deliberately
 *
 * The bench tolerates an anonymous session and renders its own sign-in, so a
 * gate here would fight the surface it is meant to protect. The enforcement is
 * the API's: `GET /bench/work` is `@Roles('admin','operator','packer')`, so a
 * session without one of those reads an error state rather than a blank list —
 * a refusal it can see, rather than a screen that looks merely empty.
 *
 * @module apps/web/src/pages/bench
 */
import type { ReactElement } from 'react';

import { BenchSurface, BenchWorkList } from '../../features/bench';

export function BenchPage(): ReactElement {
  return (
    <BenchSurface>
      <BenchWorkList />
    </BenchSurface>
  );
}
