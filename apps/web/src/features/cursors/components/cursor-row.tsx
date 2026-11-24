/**
 * CursorRow (#4024)
 *
 * One sync on the Sync progress page. The whole row is a button that opens
 * the detail panel; the key is never truncated (it wraps).
 *
 * @module apps/web/src/features/cursors/components
 */
import type { ReactElement } from 'react';
import { StatusBadge } from '../../../shared/ui/status-badge';
import type { CursorHealth, CursorProgress } from '../lib/read-cursor-health';
import type { CursorOverviewItem } from '../api/cursors.types';
import type { SyncProgressCopy } from '../lib/sync-progress-copy';

export interface CursorRowView {
  cursor: CursorOverviewItem;
  label: string;
  health: CursorHealth;
  progress: CursorProgress;
}

interface CursorRowProps {
  view: CursorRowView;
  showKeys: boolean;
  ago: (iso: string) => string;
  formatWhen: (iso: string) => string;
  onOpen: () => void;
  copy: SyncProgressCopy;
}

export function lastRunLine(
  view: CursorRowView,
  ago: (iso: string) => string,
  C: SyncProgressCopy
): { text: string; failed: boolean } | null {
  const run = view.cursor.lastRun;
  if (!run) return null;
  if (run.status === 'dead') return { text: C.lastRunFailed(ago(run.at)), failed: true };
  if (run.status === 'running') return { text: C.lastRunRunning, failed: false };
  if (run.status === 'queued') return { text: C.lastRunQueued, failed: false };
  return { text: C.lastRunOk(ago(run.at)), failed: false };
}

export function CursorRow({
  view,
  showKeys,
  ago,
  formatWhen,
  onOpen,
  copy,
}: CursorRowProps): ReactElement {
  const { cursor, label, health, progress } = view;
  const job = lastRunLine(view, ago, copy);
  return (
    <button
      type="button"
      className="card-button-reset sync-progress__row"
      onClick={onOpen}
      aria-label={`${label}, ${health.label}`}
    >
      <span className="sync-progress__what">
        <span className="sync-progress__label">{label}</span>
        {showKeys ? <span className="sync-progress__key">{cursor.cursorKey}</span> : null}
        {job ? (
          <span
            className={
              job.failed ? 'sync-progress__job sync-progress__job--fail' : 'sync-progress__job'
            }
          >
            {job.text}
          </span>
        ) : null}
      </span>
      <span className="sync-progress__pos">
        <span
          className={
            progress.empty
              ? 'sync-progress__pos-main sync-progress__pos-main--empty'
              : 'sync-progress__pos-main'
          }
        >
          {progress.main}
        </span>
        {progress.sub ? <span className="sync-progress__pos-sub">{progress.sub}</span> : null}
      </span>
      <span className="sync-progress__state">
        <StatusBadge tone={health.tone} withDot={health.id !== 'ok' && health.id !== 'plain'}>
          {health.label}
        </StatusBadge>
      </span>
      <span className="sync-progress__time" title={formatWhen(cursor.updatedAt)}>
        {ago(cursor.updatedAt)}
      </span>
      <span className="sync-progress__chev" aria-hidden="true">
        ›
      </span>
    </button>
  );
}
