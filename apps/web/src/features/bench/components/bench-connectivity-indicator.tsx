/**
 * The bench's connectivity readout (#3422, on #3407's decision)
 *
 * Moved out of the bench's own topbar when `/bench` started rendering the
 * application's `ShellTopbar` instead. The readout itself is unchanged: amber
 * means what the bench can prove - the network here is fine and OpenLinker is
 * not answering - never a scanner diagnosis nothing here can observe.
 *
 * It is a READOUT of the one `useBenchReachability` instance `BenchSurface`
 * holds, never a second opinion: if it disagrees with the surface that refuses
 * scans, the readout is what is wrong.
 *
 * @module apps/web/src/features/bench/components
 */
import type { ReactElement } from 'react';

import { benchConnectivityCopy } from '../lib/bench-connectivity.copy';
import { useBenchReachabilityContext } from '../hooks/bench-reachability-context';

export function BenchConnectivityIndicator(): ReactElement {
  // `?? 'ok'`: with no provider this readout has nothing to report, so the
  // quiet state is the honest one.
  const connectivity = useBenchReachabilityContext()?.connectivity ?? 'ok';
  const copy =
    connectivity === 'link-down'
      ? benchConnectivityCopy.connectivity.linkDown
      : connectivity === 'server-unreachable'
        ? benchConnectivityCopy.connectivity.serverUnreachable
        : benchConnectivityCopy.connectivity.ok;

  // A `title` carries the detail, and the dot is paired with a word so colour
  // is never the only signal.
  return (
    <span
      className={`bench-conn bench-conn--${connectivity}`}
      data-testid="bench-connectivity"
      data-connectivity={connectivity}
      title={copy.detail}
    >
      <span className="bench-conn__dot" aria-hidden="true" />
      <span className="bench-conn__label">{copy.label}</span>
    </span>
  );
}
