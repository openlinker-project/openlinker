/**
 * Pack bench — public surface (#2413, W3b-1)
 *
 * Surface A only: who is at the bench, the idle lock and the handover. The
 * bench's CONTENT — the work list, opening a parcel, verification, documents —
 * is #2416 and #2418, and this barrel widens when they need it.
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
