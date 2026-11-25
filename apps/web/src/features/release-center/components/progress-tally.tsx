/**
 * Progress tally (shared)
 *
 * "Required 2/3 · Optional 1/2 · To view 1/4" under a progress strip. A group with
 * nothing in it is left out, so a card with only guides says only that.
 *
 * @module features/release-center/components
 */
import type { ReactElement } from 'react';
import { interpolate, useMessages } from '../../../shared/i18n';
import type { ProgressCounts } from '../lib/progress-counts';
import type { ProgressSegmentKind } from './progress-segment';

const ORDER: readonly ProgressSegmentKind[] = ['required', 'optional', 'showcase'];

export function ProgressTally({ counts }: { counts: ProgressCounts }): ReactElement | null {
  const copy = useMessages('release-center').panel.tally;
  const parts = ORDER.filter((kind) => counts[kind].total > 0);
  if (parts.length === 0) return null;
  return (
    <ul className="pseg-tally">
      {parts.map((kind) => (
        <li key={kind} className="pseg-tally__item" data-kind={kind}>
          <span className="pseg-tally__mark" aria-hidden="true">
            <span className="pseg" data-kind={kind} data-state="done" />
          </span>
          {interpolate(copy[kind], { done: counts[kind].done, total: counts[kind].total })}
        </li>
      ))}
    </ul>
  );
}
