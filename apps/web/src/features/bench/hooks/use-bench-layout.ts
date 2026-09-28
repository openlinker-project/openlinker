/**
 * Which bench is on screen (mobile-first rebuild, epic #3401)
 *
 * Three layouts, not one layout scaled down:
 *
 * - `desktop` — the two-pane bench. The rail sits beside the parcel because
 *   there is room for both, and the scan field lives on the hero card.
 * - `tablet` / `phone` — the bench is rebuilt around the BOTTOM of the screen.
 *   A packer here is holding a box in one hand, so everything they touch is
 *   sticky furniture within thumb reach and the reading matter scrolls above
 *   it. The two differ only in how that furniture is laid out: the phone
 *   stacks it, the tablet turns it sideways.
 *
 * ## Why a JS breakpoint rather than CSS alone
 *
 * Most of the difference IS css, and stays css. What cannot be is the pieces
 * that only exist below the breakpoint — the item accordion, the scan dock,
 * the camera sheet — and the pieces that must not be MOUNTED twice: a second
 * copy of the scan field would be a second thing the scanner listener and the
 * `Esc` handler could focus, and a second copy of the work list would poll a
 * second time. So the layout is decided once, here, and the tree is built for
 * it.
 *
 * The breakpoints match the stylesheet's own (900 px for the grid, 640 px for
 * the hero and the doc cards) so the two can never disagree about which
 * bench a packer is looking at.
 *
 * @module apps/web/src/features/bench/hooks
 */
import { useMediaQuery } from '../../../shared/ui/use-media-query';

export type BenchLayout = 'phone' | 'tablet' | 'desktop';

/** Matches `.bench-grid`'s own collapse in `index.css`. */
export const BENCH_TWO_PANE_MIN_WIDTH = 900;
/** Matches the hero's and the doc cards' own stacking rule. */
export const BENCH_PHONE_MAX_WIDTH = 640;

export function useBenchLayout(): BenchLayout {
  const compact = useMediaQuery(`(max-width: ${String(BENCH_TWO_PANE_MIN_WIDTH - 0.02)}px)`);
  const phone = useMediaQuery(`(max-width: ${String(BENCH_PHONE_MAX_WIDTH)}px)`);

  if (phone) return 'phone';
  return compact ? 'tablet' : 'desktop';
}
