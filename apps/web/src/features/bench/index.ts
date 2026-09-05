/**
 * Pack bench — public surface (#2413, widened by #2416)
 *
 * #2413 shipped Surface A only — who is at the bench, the idle lock and the
 * handover — and recorded that the bench's CONTENT would widen this barrel.
 * #2416 is the first half of that: the work list, and the scanner primitive
 * Surfaces D and E consume. Opening and verifying a parcel is still #2418.
 *
 * Deliberately NOT exported, per the start-narrow rule: the copy module (it is
 * read by the two components inside this folder and by nothing outside), and
 * `BenchIdentityOverlay` / `BenchIdentityBar` individually — a caller composing
 * them by hand could render the bar without the overlay and ship a bench that
 * never locks. `BenchSurface` is the composition, and it is what leaves.
 *
 * @module apps/web/src/features/bench
 */
export { BenchSurface } from './components/bench-surface';
export type { BenchSurfaceProps } from './components/bench-surface';
export {
  BENCH_IDLE_TIMEOUT_DEFAULT_MS,
  resolveBenchIdleTimeoutMs,
} from './hooks/use-bench-identity';

// #2416 — Surface B. The page composes the list inside `BenchSurface`.
export { BenchWorkList } from './components/bench-work-list';
export type { BenchWorkListProps } from './components/bench-work-list';

// #2416 — Surface C. The primitive #2418/#2420 consume, and the durable
// per-gesture id that makes a legitimate second scan a second unit (G3).
export { useScannerInput } from './hooks/use-scanner-input';
export type {
  ScannerGesture,
  UseScannerInputOptions,
  UseScannerInputResult,
} from './hooks/use-scanner-input';
export { listPendingGestures, settleGesture } from './lib/scanner-gesture-log';
export type { PendingGesture } from './lib/scanner-gesture-log';

// #2418 — Surfaces D, E and F. ONE component: the box, its verification and
// the paper that travels with it are only correct together. `BenchDocumentsPanel`
// is deliberately not exported on its own — a caller rendering it beside the
// parcel rather than inside it could show a "ready to print" label next to a box
// that is still open, and `BenchParcelLineRow` alone would be a list of lines
// with no surface owning the scan.
export { BenchParcelView } from './components/bench-parcel';
export type { BenchParcelProps } from './components/bench-parcel';

// #2421 — Surface H and C4 are BEHAVIOUR of the parcel view, not a component a
// caller composes, so nothing new leaves this barrel. The reachability hook,
// the sound module and the in-flight ledger are deliberately private: a second
// consumer of the reachability hook would be a second answer to "can this bench
// reach OpenLinker" with its own recovery rule, and a caller reaching
// `playScanSound` directly could sound a refusal the surface never showed —
// which is precisely the audio-instead-of-visible arrangement C4 forbids.

export type { BenchWork, BenchWorkList as BenchWorkListData } from './api/bench-work.types';
export type { BenchParcel, BenchParcelLine } from './api/bench-parcel.types';

// Deliberately NOT exported, per the start-narrow rule: the copy module and the
// presentation rules (read only inside this folder), the row and the two empty
// states (composed by `BenchWorkList`, and a caller assembling them by hand
// could render rows without the sections that carry state by POSITION — story
// B4), the api client and the query keys (the list reaches transport through
// its hooks, and the mutation already invalidates the whole feature), and the
// scanner's pure rules (the hook is the seam; a second consumer of the raw
// thresholds would be a second scan-versus-typing rule).
