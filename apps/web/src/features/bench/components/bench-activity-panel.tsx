/**
 * Recent activity for one parcel (#3411, mockup-parity epic #3401)
 *
 * The verification ledger, projected server-side with each line's product
 * name and newest first (`BenchActivityEntry.kind`: `verified` | `undone`).
 * A compact, always-visible log rather than a full-page state surface — the
 * mockup's own `.activity` block is a small sidebar, not a primary read.
 *
 * @module apps/web/src/features/bench/components
 */
import type { ReactElement } from 'react';

import { formatAbsoluteTime } from '../../../shared/format/format-date';
import { useBenchActivityQuery } from '../hooks/use-bench-activity-query';
import { benchParcelCopy } from '../lib/bench-parcel.copy';

export interface BenchActivityPanelProps {
  readonly workId: string;
}

export function BenchActivityPanel({ workId }: BenchActivityPanelProps): ReactElement | null {
  const query = useBenchActivityQuery(workId);

  // Absent rather than an empty box: a panel with nothing to say should not
  // occupy space next to the lines a packer is actively working.
  if (query.isLoading || query.isError) return null;
  const entries = query.data ?? [];
  if (entries.length === 0) return null;

  return (
    <section className="bench-activity" data-testid="bench-activity-panel">
      <h3>{benchParcelCopy.activity.heading}</h3>
      <ul>
        {entries.map((entry) => (
          <li key={`${entry.workLineId}-${entry.kind}-${entry.at}`}>
            <time dateTime={entry.at}>{formatAbsoluteTime(entry.at)}</time>
            <span>
              {entry.name ?? benchParcelCopy.lines.unnamed}
              {' — '}
              {entry.kind === 'undone'
                ? benchParcelCopy.activity.undone
                : benchParcelCopy.activity.verified}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
