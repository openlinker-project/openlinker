/**
 * The bench's two empty states (#2416, `W3b-3`, story B3)
 *
 * *"Nothing to pack right now"* and *"routing is not switched on, so this bench
 * will never receive work"* are DIFFERENT FACTS, and the whole point of this
 * component is that they never render as the same screen.
 *
 * Conflating them is what makes a working bench look broken: a packer staring
 * at an empty page cannot tell whether to wait or to fetch a supervisor, and
 * the second state does not resolve by waiting however long they do it.
 *
 * The second names its remedy, per B3. It points at the settings page that says
 * who carries work out, because *that* is the missing fact — creating a stock
 * location is a different setup step and would not make a parcel arrive here.
 *
 * @module apps/web/src/features/bench/components
 */
import type { ReactElement } from 'react';

import { Alert } from '../../../shared/ui/alert';
import { benchWorkCopy } from '../lib/bench-work.copy';

export interface BenchWorkEmptyProps {
  /**
   * Whether work can reach this bench at all.
   *
   * The caller passes the server's answer rather than inferring one from an
   * empty array — an empty array is exactly what both states look like, which
   * is the confusion this component exists to remove.
   */
  readonly routingReady: boolean;
}

export function BenchWorkEmpty({ routingReady }: BenchWorkEmptyProps): ReactElement {
  if (routingReady) {
    return (
      <div className="bench-work-empty" data-testid="bench-work-empty-idle">
        <h2 className="bench-work-empty__title">{benchWorkCopy.emptyIdle.title}</h2>
        <p className="bench-work-empty__body">{benchWorkCopy.emptyIdle.body}</p>
        {/* Says the pipe is healthy, which is the fact that distinguishes this
            screen from the other one. Without it the two read alike. */}
        <p className="bench-work-empty__note">{benchWorkCopy.emptyIdle.reassurance}</p>
      </div>
    );
  }

  return (
    <div className="bench-work-empty" data-testid="bench-work-empty-not-routed">
      <h2 className="bench-work-empty__title">{benchWorkCopy.emptyNotRouted.title}</h2>
      <p className="bench-work-empty__body">{benchWorkCopy.emptyNotRouted.body}</p>
      <Alert tone="warning" title={benchWorkCopy.emptyNotRouted.remedyTitle}>
        {benchWorkCopy.emptyNotRouted.remedyBody}
      </Alert>
    </div>
  );
}
