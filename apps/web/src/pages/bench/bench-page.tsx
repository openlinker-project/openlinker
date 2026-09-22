/**
 * Pack bench (#2413 Surface A, #2416 Surfaces B and C, #2418 Surfaces D–F;
 * spec §§ 2.1–2.6; laid out as the mockup's two-pane bench by the
 * mockup-parity epic #3401)
 *
 * Who is signed in, the idle lock and the handover (#2413), wrapped around the
 * work waiting at the bench (#2416) and the box being packed (#2418).
 *
 * ## The rail and the box are SIDE BY SIDE, never one after the other
 *
 * `docs/plans/mockups/pack-bench-redesign.html` is a 340 px rail beside a
 * 1fr panel (`.bench-grid`), and the pairing is the surface's whole working
 * shape: a packer reads the next parcel off the rail while their hands are in
 * the current box. Swapping the list OUT for the parcel — which is what this
 * page did before #3401 — makes "what is next" invisible for the entire time
 * a box is open, which is most of a shift.
 *
 * Both panes are therefore mounted at once. Which box is open is still page
 * state, NOT a route: a route would put the two on opposite sides of a
 * navigation, unmounting `BenchSurface` and with it the idle lock, the
 * handover and every scan already made — A2 and A3 both hang on that subtree
 * never unmounting.
 *
 * ## The list is the CHILD of `BenchSurface`, and that placement is the feature
 *
 * `BenchSurface` never unmounts its children, which is how *"locking never
 * discards progress"* (A3) and *"verification progress survives the switch"*
 * (A2) hold. Rendering the grid beside the surface rather than inside it would
 * forfeit both — and would do so invisibly, since every component test mounts
 * these pieces directly.
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
import { useState, type ReactElement } from 'react';

import {
  BenchMetricRow,
  BenchParcelPlaceholder,
  BenchParcelView,
  BenchSurface,
  BenchWorkList,
} from '../../features/bench';

export function BenchPage(): ReactElement {
  // #2418. See the module docblock — page state, never a route.
  const [openWorkId, setOpenWorkId] = useState<string | null>(null);

  return (
    <BenchSurface>
      <div className="bench-shell">
        {/* #3413 (epic #3401). Above the grid, not inside the rail: it is a
            fact about the whole bench, and the mockup puts it there. */}
        <BenchMetricRow />
        <section className="bench-grid" data-testid="bench-grid">
          <aside className="bench-panel bench-rail">
            <BenchWorkList
              activeWorkId={openWorkId}
              onOpenParcel={(workId) => {
                setOpenWorkId(workId);
              }}
            />
          </aside>
          <main className="bench-panel bench-main">
            {openWorkId === null ? (
              <BenchParcelPlaceholder />
            ) : (
              <BenchParcelView
                workId={openWorkId}
                onClose={() => {
                  setOpenWorkId(null);
                }}
              />
            )}
          </main>
        </section>
      </div>
    </BenchSurface>
  );
}
