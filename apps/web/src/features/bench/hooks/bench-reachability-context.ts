/**
 * One reachability answer for the whole bench (#3407 / #3422)
 *
 * `useBenchReachability` is stateful: `requestFailed` is set by the parcel
 * pane reporting a request that got no answer, and cleared by the next answer
 * of any kind. So a SECOND call of the hook does not observe a second copy of
 * the same truth - it observes a copy that nobody reports into, whose
 * `requestFailed` is permanently false. The topbar indicator built that way
 * would render amber exactly never, which is the "declared but inert" shape
 * this epic has already been bitten by once.
 *
 * `BenchSurface` therefore holds the single instance and publishes it here.
 * The indicator is a READOUT; the parcel pane is the reporter. If the two ever
 * disagree, the readout is the thing that is wrong.
 *
 * The default is `null` - "no provider here" - and NOT an `ok`-shaped object
 * with no-op reporters. That was the first version and it was wrong in a way
 * worth recording: this hook is STATEFUL, so a pane handed no-op reporters can
 * call `reportUnreachable()` on a failed request and change nothing, and then
 * never renders the banner that says the bench cannot reach OpenLinker. Six
 * #2421 tests that mount the pane on its own caught it; a host that rendered
 * the pane outside the surface would have had the same hole in production,
 * silently, because a pane that refuses nothing looks exactly like a pane with
 * nothing to refuse.
 *
 * A consumer therefore falls back to its OWN `useBenchReachability()` when the
 * context is absent, which is precisely its pre-context behaviour.
 *
 * @module apps/web/src/features/bench/hooks
 */
import { createContext, useContext } from 'react';

import type { BenchReachability } from './use-bench-reachability';

export const BenchReachabilityContext = createContext<BenchReachability | null>(null);

/** The shared instance, or `null` when this subtree has no provider. */
export function useBenchReachabilityContext(): BenchReachability | null {
  return useContext(BenchReachabilityContext);
}
