/**
 * CursorDetailPanel (#4024)
 *
 * The detail of one sync, opened from its row: health with its reason, where
 * it is, its runs, Run now, Fetch again, and the raw value behind a
 * disclosure. Every badge and heading links into the guide.
 *
 * @module apps/web/src/features/cursors/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { SidePanel } from '../../../shared/ui/side-panel';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { Button } from '../../../shared/ui/button';
import { Alert } from '../../../shared/ui/alert';
import { CopyableId } from '../../../shared/ui/copyable-id';
import { useToast } from '../../../shared/ui/toast-provider';
import { useEnqueueSyncJobMutation } from '../../sync-jobs';
import { describeCursor } from '../lib/cursor-catalogue';
import { SYNC_PROGRESS_COPY } from '../lib/sync-progress.copy';
import type { CursorRowView } from './cursor-row';
import { RewindPanel } from './rewind-panel';

export interface CursorDetailConnection {
  id: string;
  name: string;
  platformType: string | null;
  isSystem: boolean;
}

interface CursorDetailPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  view: CursorRowView | null;
  connection: CursorDetailConnection | null;
  canAct: boolean;
  ago: (iso: string) => string;
  formatWhen: (iso: string) => string;
  onExplain: (guideId: string) => void;
}

export function CursorDetailPanel({
  open,
  onOpenChange,
  view,
  connection,
  canAct,
  ago,
  formatWhen,
  onExplain,
}: CursorDetailPanelProps): ReactElement {
  const S = SYNC_PROGRESS_COPY.sheet;
  const enqueue = useEnqueueSyncJobMutation();
  const { showToast } = useToast();
  const d = view ? describeCursor(view.cursor.cursorKey) : null;
  const run = view?.cursor.lastRun ?? null;

  const runNow = (): void => {
    if (!view || !connection || !d?.runNow) return;
    enqueue.mutate(
      {
        jobType: d.runNow.jobType,
        connectionId: connection.id,
        payload: d.runNow.payload,
        idempotencyKey: `manual:${connection.id}:${d.runNow.jobType}:${Date.now()}`,
      },
      {
        onSuccess: () => {
          showToast({ tone: 'success', description: S.runQueued });
        },
        onError: (error) => {
          showToast({ tone: 'error', description: S.runFailed(error.message) });
        },
      },
    );
  };

  const historyHref =
    connection && run
      ? `/jobs-logs?connectionId=${encodeURIComponent(connection.id)}&jobType=${encodeURIComponent(run.jobType)}`
      : connection
        ? `/jobs-logs?connectionId=${encodeURIComponent(connection.id)}`
        : '/jobs-logs';

  return (
    <SidePanel
      open={open}
      onOpenChange={onOpenChange}
      title={view ? view.label : ''}
      description={S.description}
      kicker={connection ? connection.name : null}
      meta={
        view ? (
          <>
            <StatusBadge tone={view.health.tone} withDot={view.health.id !== 'ok' && view.health.id !== 'plain'}>
              {view.health.label}
            </StatusBadge>
            <button
              type="button"
              className="card-button-reset sync-progress__help-link"
              onClick={() => {
                onExplain(view.health.guideId);
              }}
            >
              {S.whatDoesThisMean}
            </button>
          </>
        ) : null
      }
    >
      {view && connection && d ? (
        <div className="sync-progress__detail">
          {view.health.why ? (
            <Alert tone={view.health.tone === 'error' ? 'error' : 'warning'} density="compact">
              {view.health.why}
            </Alert>
          ) : null}

          <section className="sync-progress__detail-section">
            <div className="sync-progress__detail-head">
              <h3>{S.whereItIs}</h3>
              {d.guideId ? (
                <button
                  type="button"
                  className="card-button-reset sync-progress__help-link"
                  onClick={() => {
                    if (d.guideId) onExplain(d.guideId);
                  }}
                >
                  {S.aboutThisSync}
                </button>
              ) : null}
            </div>
            <p className="sync-progress__detail-lead">
              {view.progress.main}
              {view.progress.sub ? `. ${view.progress.sub}.` : '.'}
            </p>
            {view.cursor.family ? (
              <p className="sync-progress__hint">{SYNC_PROGRESS_COPY.kindLine[view.cursor.family]}</p>
            ) : null}
          </section>

          <section className="sync-progress__detail-section">
            <h3>{S.runs}</h3>
            <dl className="sync-progress__kv">
              <dt>{S.lastMoved}</dt>
              <dd>
                {formatWhen(view.cursor.updatedAt)} ({ago(view.cursor.updatedAt)})
              </dd>
              {d.cadenceMinutes ? (
                <>
                  <dt>{S.runsEvery}</dt>
                  <dd>{S.everyMinutes(d.cadenceMinutes)}</dd>
                </>
              ) : null}
              {run ? (
                <>
                  <dt>{S.lastRun}</dt>
                  <dd>{S.lastRunValue(run.status, ago(run.at))}</dd>
                </>
              ) : null}
            </dl>
            <div className="sync-progress__actions">
              {d.runNow && !connection.isSystem ? (
                <Button onClick={runNow} disabled={!canAct || enqueue.isPending}>
                  {S.runNow}
                </Button>
              ) : null}
              <Link className="button button--secondary" to={historyHref}>
                {S.viewHistory}
              </Link>
            </div>
          </section>

          {view.cursor.rewind || view.cursor.family === 'event-bookmark' ? (
            <section className="sync-progress__detail-section">
              <div className="sync-progress__detail-head">
                <h3>{S.fetchAgain}</h3>
                <button
                  type="button"
                  className="card-button-reset sync-progress__help-link"
                  onClick={() => {
                    onExplain('q-safe');
                  }}
                >
                  {S.isItSafe}
                </button>
              </div>
              {view.cursor.rewind ? (
                <RewindPanel connectionId={connection.id} cursor={view.cursor} canAct={canAct} />
              ) : (
                <p className="sync-progress__hint">{S.feedCannotRewind}</p>
              )}
            </section>
          ) : null}

          <details className="sync-progress__tech">
            <summary>{S.technical}</summary>
            <dl className="sync-progress__kv">
              {view.progress.parsedPass ? (
                <>
                  <dt>{S.passId}</dt>
                  <dd className="mono-text">{view.progress.parsedPass.cycleId}</dd>
                  <dt>{S.itemsDone}</dt>
                  <dd>{view.progress.parsedPass.offset}</dd>
                </>
              ) : null}
              <dt>{S.firstSeen}</dt>
              <dd>{formatWhen(view.cursor.createdAt)}</dd>
              <dt>{S.connectionId}</dt>
              <dd>
                <CopyableId id={connection.id} />
              </dd>
              <dt>{S.rawValue}</dt>
              <dd>
                {view.cursor.value === '' ? (
                  <span className="sync-progress__empty-value">{S.emptyString}</span>
                ) : (
                  <CopyableId id={view.cursor.value} />
                )}
              </dd>
              <dt>{S.key}</dt>
              <dd>
                <CopyableId id={view.cursor.cursorKey} />
              </dd>
            </dl>
          </details>
        </div>
      ) : null}
    </SidePanel>
  );
}
