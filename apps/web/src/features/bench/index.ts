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

export type { BenchWork, BenchWorkList as BenchWorkListData } from './api/bench-work.types';

// Deliberately NOT exported, per the start-narrow rule: the copy module and the
// presentation rules (read only inside this folder), the row and the two empty
// states (composed by `BenchWorkList`, and a caller assembling them by hand
// could render rows without the sections that carry state by POSITION — story
// B4), the api client and the query keys (the list reaches transport through
// its hooks, and the mutation already invalidates the whole feature), and the
// scanner's pure rules (the hook is the seam; a second consumer of the raw
// thresholds would be a second scan-versus-typing rule).
