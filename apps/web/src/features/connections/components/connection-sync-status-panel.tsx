import type { ReactElement } from 'react';
import { useConnectionSyncStatusQuery } from '../hooks/use-connection-sync-status-query';
import type { ConnectionBacklogStatus, ConnectionSyncStatus } from '../api/connections.types';
import { formatDateTime } from '../../../shared/format/format-date';
import { formatDurationMs } from '../../../shared/format/format-duration-ms';
import { LoadingState, ErrorState } from '../../../shared/ui/feedback-state';
import { Alert } from '../../../shared/ui/alert';
import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';

/**
 * Sync status panel (#2615), on the connection detail page's health tab.
 *
 * "Waiting" means due work only. A task backing off after a failure is queued
 * but nothing is holding it up, so counting it as queue depth would report a
 * failing job as a stalled worker.
 *
 * Two facts are up front: the status badge and one sentence about the queue.
 * Everything else - the measured rates, the derived threshold, the mean
 * attempt time, cursor recency - sits behind a disclosure, because an operator
 * opening this panel wants to know whether anything is wrong before they want
 * the arithmetic.
 *
 * Read-only throughout, so neither demo-mode policy applies: there is no
 * control to lock and none to hide.
 *
 * Copy never claims more than the read supports. `unknown` says the queue
 * could not be read rather than reporting an empty one, a clearance estimate
 * is omitted rather than guessed when the queue is not shrinking, and a
 * connection with no saved sync position is described as normal for one fed by
 * shop notifications rather than flagged.
 */

interface ConnectionSyncStatusPanelProps {
  connectionId: string;
}

const STATUS_LABEL: Record<ConnectionBacklogStatus, string> = {
  idle: 'Nothing waiting',
  draining: 'Catching up',
  growing: 'Falling behind',
  failing: 'Tasks failing',
  backlogged: 'Backlog',
  unknown: 'Unknown',
};

const STATUS_TONE: Record<ConnectionBacklogStatus, StatusBadgeTone> = {
  idle: 'success',
  draining: 'success',
  growing: 'warning',
  failing: 'warning',
  backlogged: 'error',
  unknown: 'warning',
};

function formatCount(value: number): string {
  return new Intl.NumberFormat('en-GB').format(Math.round(value));
}

function formatRate(perHour: number): string {
  return `${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 }).format(perHour)} an hour`;
}

/**
 * Waits here are routinely measured in days, which `formatDurationMs` would
 * render as three-figure hours.
 */
function formatWait(ms: number): string {
  const hours = ms / (60 * 60 * 1000);
  if (hours < 1) {
    return `${Math.max(1, Math.round(ms / 60000))} min`;
  }
  if (hours < 48) {
    return `${Math.round(hours)} h`;
  }
  return `${Math.round(hours / 24)} days`;
}

function headline(status: ConnectionSyncStatus): string {
  if (status.status === 'unknown') {
    return 'The queue could not be read just now. Try again in a moment.';
  }
  if (status.status === 'failing') {
    return 'Nothing has finished successfully in the last hour and tasks are failing. The queue may look empty because work is dying rather than getting done.';
  }
  if (status.queuedCount === 0) {
    return 'No work is waiting for this connection.';
  }
  const waiting = `${formatCount(status.queuedCount)} ${
    status.queuedCount === 1 ? 'task is' : 'tasks are'
  } waiting`;
  const oldest =
    status.oldestQueuedWaitMs === null
      ? ''
      : `, the oldest for ${formatWait(status.oldestQueuedWaitMs)}`;

  if (status.status === 'draining') {
    const clearance =
      status.estimatedClearanceMs === null
        ? ''
        : ` About ${formatWait(status.estimatedClearanceMs)} to clear at the current pace.`;
    return `${waiting}${oldest}, and the queue is shrinking.${clearance}`;
  }
  return `${waiting}${oldest}, and the queue is not shrinking.`;
}

export function ConnectionSyncStatusPanel({
  connectionId,
}: ConnectionSyncStatusPanelProps): ReactElement {
  const statusQuery = useConnectionSyncStatusQuery(connectionId);
  const data = statusQuery.data;

  return (
    <div className="panel panel--dense">
      <div className="panel__header">
        <div>
          <p className="eyebrow">Health</p>
          <h3 className="section-title">Sync queue</h3>
        </div>
        {data ? (
          <span className="panel__meta">
            <StatusBadge tone={STATUS_TONE[data.status]}>{STATUS_LABEL[data.status]}</StatusBadge>
          </span>
        ) : null}
      </div>

      {statusQuery.isLoading ? (
        <LoadingState
          title="Loading sync queue"
          message="Counting the work waiting for this connection."
        />
      ) : null}

      {statusQuery.error ? (
        <ErrorState
          title="Unable to load the sync queue"
          message={statusQuery.error.message}
          action={
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void statusQuery.refetch()}
            >
              Retry
            </button>
          }
        />
      ) : null}

      {data ? (
        <>
          {data.alerting ? (
            <Alert tone="error" title="This connection is behind">
              Work has been waiting more than a day and the queue is not shrinking. Orders and stock
              for this connection are out of date until it catches up.
            </Alert>
          ) : null}

          <p className="connection-sync-status__headline">{headline(data)}</p>

          {data.deadCount > 0 ? (
            <p className="connection-sync-status__note">
              {formatCount(data.deadCount)} {data.deadCount === 1 ? 'task has' : 'tasks have'} given
              up after repeated failures in the last week. They will not run again on their own.
            </p>
          ) : null}

          {data.runningCount > 0 && data.drainRatePerHour === 0 ? (
            <p className="connection-sync-status__note">
              {formatCount(data.runningCount)} {data.runningCount === 1 ? 'task has' : 'tasks have'}{' '}
              been picked up but nothing has finished in the last hour. That usually means the
              background worker stopped part-way through.
            </p>
          ) : null}

          <details className="connection-sync-status__details">
            <summary>Details</summary>
            <dl className="definition-list">
              <div>
                <dt>Running now</dt>
                <dd>{formatCount(data.runningCount)}</dd>
              </div>
              <div>
                <dt>Waiting to retry</dt>
                <dd>{formatCount(data.deferredCount)}</dd>
              </div>
              <div>
                <dt>Last success</dt>
                <dd>
                  {data.lastSucceededAt === null
                    ? 'None in the last week'
                    : formatDateTime(data.lastSucceededAt)}
                </dd>
              </div>
              <div>
                <dt>New work</dt>
                <dd>{formatRate(data.arrivalRatePerHour)}</dd>
              </div>
              <div>
                <dt>Finished work</dt>
                <dd>{formatRate(data.drainRatePerHour)}</dd>
              </div>
              <div>
                <dt>Alert above</dt>
                <dd>
                  {data.drainRatePerHour === 0
                    ? 'Not measured yet - nothing finished in the last hour'
                    : `${formatCount(data.alertThresholdJobs)} waiting`}
                </dd>
              </div>
              <div>
                <dt>Typical task time</dt>
                <dd>
                  {data.averageAttemptDurationMs === null
                    ? 'Not measured yet'
                    : `${formatDurationMs(data.averageAttemptDurationMs) ?? '-'} (over ${formatCount(
                        data.attemptDurationSampleSize,
                      )} ${data.attemptDurationSampleSize === 1 ? 'task' : 'tasks'})`}
                </dd>
              </div>
              <div>
                <dt>Sync position last moved</dt>
                <dd>
                  {data.lastCursorAdvanceAt === null
                    ? 'No saved position - normal when the shop notifies us instead'
                    : formatDateTime(data.lastCursorAdvanceAt)}
                </dd>
              </div>
            </dl>
            <p className="connection-sync-status__note">
              New and finished work are measured over the last hour. Waiting counts only tasks
              whose next attempt is due; a task backing off after a failure is counted under
              "Waiting to retry" instead. The alert level is what this connection normally
              finishes in a day, so it moves with the shop rather than being a fixed number, and it
              only alerts once the oldest waiting task is more than a day old.
            </p>
          </details>
        </>
      ) : null}
    </div>
  );
}
