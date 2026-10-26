/**
 * Pack bench (#2413 Surface A, #2416 Surfaces B and C, #2418 Surfaces D–F;
 * spec §§ 2.1–2.6; two-pane desktop and the mobile-first compact bench from
 * the mockup-parity epic #3401)
 *
 * Who is signed in, the idle lock and the handover (#2413), wrapped around the
 * work waiting at the bench (#2416) and the box being packed (#2418).
 *
 * ## TWO layouts, and the compact one is not the desktop one narrowed
 *
 * `docs/plans/mockups/pack-bench-redesign.html` is a 340 px rail beside a 1fr
 * panel, and that pairing is the desktop bench's working shape: a packer reads
 * what is next off the rail while their hands are in the current box.
 *
 * A packer on a phone is holding the box. There is no second column to read,
 * and the thing that matters is that everything they TOUCH is within thumb
 * reach — so below 900 px the bench is rebuilt rather than squeezed: one
 * column, and the scan surface becomes sticky furniture at the bottom
 * (`BenchScanDock`) with the work list summoned over it as a sheet. Squeezing
 * the two-pane layout instead put the scan control at the top of a long scroll,
 * which is the failure this whole epic started from, one device further out.
 *
 * ## Which box is open is page state in BOTH layouts, never a route
 *
 * A route would put the list and the parcel on opposite sides of a navigation,
 * so opening a box would unmount `BenchSurface` and with it the idle lock, the
 * handover and every scan already made; A2 and A3 both hang on that subtree
 * never unmounting. The compact bench's sheet is the same rule applied to the
 * rail: it is rendered OVER the parcel, never instead of it.
 *
 * ## The list is the CHILD of `BenchSurface`, and that placement is the feature
 *
 * `BenchSurface` never unmounts its children, which is how *"locking never
 * discards progress"* (A3) and *"verification progress survives the switch"*
 * (A2) hold.
 *
 * ## `/bench` stays OUTSIDE `AuthenticatedAppLayout`
 *
 * Unchanged from #2413 and load-bearing: the idle lock clears the session on
 * purpose, and that layout answers an anonymous session by navigating to
 * `/login` — which would unmount the bench mid-parcel. `bench-route-placement.test.ts`
 * pins it.
 *
 * ## No frontend role gate, deliberately
 *
 * The bench tolerates an anonymous session and renders its own sign-in, so a
 * gate here would fight the surface it is meant to protect. The enforcement is
 * the API's: `GET /bench/work` is `@Roles('admin','operator','packer')`.
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
  useBenchLayout,
} from '../../features/bench';

export function BenchPage(): ReactElement {
  // See the module docblock — page state, never a route.
  const [openWorkId, setOpenWorkId] = useState<string | null>(null);
  // Compact only: the rail is a sheet over the parcel rather than a pane
  // beside it. Ignored on desktop, where the rail is always on screen.
  const [listOpen, setListOpen] = useState(false);
  const layout = useBenchLayout();

  const list = (
    <BenchWorkList
      activeWorkId={openWorkId}
      onOpenParcel={(workId) => {
        setOpenWorkId(workId);
        setListOpen(false);
      }}
    />
  );

  if (layout !== 'desktop') {
    return (
      <BenchSurface>
        <div className="bench-shell bench-shell--compact">
          <BenchMetricRow />
          {openWorkId === null ? (
            <div className="bench-panel">{list}</div>
          ) : (
            <>
              <div className="bench-panel bench-main">
                <BenchParcelView
                  workId={openWorkId}
                  onClose={() => {
                    setOpenWorkId(null);
                  }}
                  onSwitchParcel={() => {
                    setListOpen(true);
                  }}
                />
              </div>
              {/* OVER the parcel, never instead of it: the parcel subtree
                  stays mounted, so every scan and the idle lock survive a
                  packer glancing at what else is waiting. */}
              {listOpen ? (
                <div className="bench-sheet" data-testid="bench-list-sheet">
                  <div className="bench-sheet__bar">
                    <button
                      type="button"
                      className="bench-sheet__close"
                      onClick={() => {
                        setListOpen(false);
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
                      Back to the box
                    </button>
                  </div>
                  <div className="bench-sheet__body">{list}</div>
                </div>
              ) : null}
            </>
          )}
        </div>
      </BenchSurface>
    );
  }

  return (
    <BenchSurface>
      <div className="bench-shell">
        {/* #3413 (epic #3401). Above the grid, not inside the rail: it is a
            fact about the whole bench, and the mockup puts it there. */}
        <BenchMetricRow />
        <section className="bench-grid" data-testid="bench-grid">
          <aside className="bench-panel bench-rail">{list}</aside>
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
