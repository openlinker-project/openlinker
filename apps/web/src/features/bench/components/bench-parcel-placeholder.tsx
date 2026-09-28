/**
 * The right-hand pane before a box is open (mockup-parity epic #3401)
 *
 * The two-pane bench mounts both panes at once, so the parcel pane needs
 * something to say while no parcel is open. It says what to do — pick a
 * parcel off the rail — and nothing else.
 *
 * Deliberately NOT an empty state that talks about the bench being idle:
 * "nothing is open" and "nothing can reach this bench" are different facts,
 * and `BenchWorkEmpty` already owns the second one, in the rail, where the
 * work it is about would have been.
 *
 * @module apps/web/src/features/bench/components
 */
import type { ReactElement } from 'react';

import { benchWorkCopy } from '../lib/bench-work.copy';

export function BenchParcelPlaceholder(): ReactElement {
  return (
    <div className="bench-parcel-placeholder" data-testid="bench-parcel-placeholder">
      <p className="bench-parcel-placeholder__title">{benchWorkCopy.placeholder.title}</p>
      <p className="bench-parcel-placeholder__body">{benchWorkCopy.placeholder.body}</p>
    </div>
  );
}
