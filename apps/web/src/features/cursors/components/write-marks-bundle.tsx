/**
 * WriteMarksBundle (#4024)
 *
 * One connection's per-listing stock write marks (#2617) collapsed into a
 * single summary row. They are one row per mapped offer, so listing them
 * would bury the handful of syncs an operator reads. The rows are fetched only
 * when the summary is opened, one page at a time.
 *
 * @module apps/web/src/features/cursors/components
 */
import { useState, type ReactElement } from 'react';
import type { Cursor, CursorOverviewItem, CursorWriteMarksSummary } from '../api/cursors.types';
import { useWriteMarksQuery } from '../hooks/use-write-marks-query';
import type { SyncProgressCopy } from '../lib/sync-progress-copy';
import { CursorRow, type CursorRowView } from './cursor-row';

interface WriteMarksBundleProps {
  connectionId: string;
  summary: CursorWriteMarksSummary;
  search: string;
  showKeys: boolean;
  ago: (iso: string) => string;
  formatWhen: (iso: string) => string;
  toView: (item: CursorOverviewItem) => CursorRowView;
  onOpen: (view: CursorRowView) => void;
  copy: SyncProgressCopy;
}

function asOverviewItem(c: Cursor): CursorOverviewItem {
  return { ...c, family: 'write-order', rewind: null, lastRun: null };
}

export function WriteMarksBundle({
  connectionId,
  summary,
  search,
  showKeys,
  ago,
  formatWhen,
  toView,
  onOpen,
  copy: C,
}: WriteMarksBundleProps): ReactElement {
  const [open, setOpen] = useState(false);
  const isOpen = open || search.length > 0;
  const query = useWriteMarksQuery(connectionId, summary.keyPrefix, isOpen);
  const rows = (query.data?.items ?? [])
    .filter((c) => !search || c.cursorKey.toLowerCase().includes(search))
    .map((c) => toView(asOverviewItem(c)));

  return (
    <div className="sync-progress__bundle" data-open={isOpen}>
      <button
        type="button"
        className="card-button-reset sync-progress__bundle-toggle"
        aria-expanded={isOpen}
        onClick={() => {
          setOpen(!open);
        }}
      >
        <span className="sync-progress__bundle-caret" aria-hidden="true">
          ›
        </span>
        <span>{C.writeMarks(summary.count)}</span>
        <span className="sync-progress__bundle-range">
          {C.writeMarksRange(ago(summary.newestValue), ago(summary.oldestValue))}
        </span>
      </button>
      <div className="sync-progress__bundle-body">
        <div className="sync-progress__bundle-inner">
          {isOpen
            ? rows.map((view) => (
                <CursorRow
                  key={view.cursor.cursorKey}
                  view={view}
                  showKeys={showKeys}
                  ago={ago}
                  formatWhen={formatWhen}
                  copy={C}
                  onOpen={() => {
                    onOpen(view);
                  }}
                />
              ))
            : null}
          {isOpen && query.data && query.data.total > query.data.items.length ? (
            <p className="sync-progress__note">
              {C.writeMarksMore(query.data.items.length, query.data.total)}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
