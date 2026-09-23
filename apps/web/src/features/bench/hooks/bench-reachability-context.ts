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
 * The default is the `ok` shape with no-op reporters rather than `null`,
 * because a consumer rendered outside the provider - a test mounting the
 * parcel pane on its own, today - should degrade to "nothing to report" rather
 * than crash, and `unreachable: false` is the safe direction: it refuses no
 * work it should have accepted, and the first real failure still flips it once
 * a provider is present.
 *
 * @module apps/web/src/features/bench/hooks
 */
import { createContext, useContext } from 'react';

import type { BenchReachability } from './use-bench-reachability';

const FALLBACK: BenchReachability = {
  unreachable: false,
  connectivity: 'ok',
  reportUnreachable: () => {},
  reportReached: () => {},
};

export const BenchReachabilityContext = createContext<BenchReachability>(FALLBACK);

export function useBenchReachabilityContext(): BenchReachability {
  return useContext(BenchReachabilityContext);
}
