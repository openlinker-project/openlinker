/**
 * Connection Sync Status Panel
 *
 * Connection detail health-tab panel rendering the per-connection sync queue
 * readout (#2615). Presentation only - the read lives in
 * `use-connection-sync-status-query`.
 *
 * @module features/connections/components
 */
import {
  interpolate,
  useFormat,
  useMessages,
  usePlural,
  type Formatters,
  type Messages,
  type PluralFn,
  type ResolvedCopy,
} from '../../../shared/i18n';
import type { ReactElement } from 'react';
import { useConnectionSyncStatusQuery } from '../hooks/use-connection-sync-status-query';
import type { ConnectionBacklogStatus, ConnectionSyncStatus } from '../api/connections.types';
import { LoadingState, ErrorState } from '../../../shared/ui/feedback-state';
import { Alert } from '../../../shared/ui/alert';
import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';
import { describeApiError } from '../../../shared/api/describe-api-error';

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

const STATUS_TONE: Record<ConnectionBacklogStatus, StatusBadgeTone> = {
  idle: 'success',
  draining: 'success',
  growing: 'warning',
  failing: 'warning',
  backlogged: 'error',
  unknown: 'warning',
};

type SyncStatusCopy = ResolvedCopy<Messages['connections']>['connectionSyncStatusPanel'];

interface SyncStatusFormatters {
  copy: SyncStatusCopy;
  format: Formatters;
  plural: PluralFn;
}

function formatCount(format: Formatters, value: number): string {
  return format.number(Math.round(value));
}

function formatRate({ copy, format }: SyncStatusFormatters, perHour: number): string {
  return interpolate(copy.perHour, {
    rate: format.number(perHour, { maximumFractionDigits: 1 }),
  });
}

/**
 * Waits here are routinely measured in days, which `formatDurationMs` would
 * render as three-figure hours.
 */
function formatWait({ copy, format, plural }: SyncStatusFormatters, ms: number): string {
  const hours = ms / (60 * 60 * 1000);
  if (hours < 1) {
    const minutes = Math.max(1, Math.round(ms / 60000));
    return interpolate(copy.wait.minutes, { n: format.number(minutes) });
  }
  if (hours < 48) {
    return interpolate(copy.wait.hours, { n: format.number(Math.round(hours)) });
  }
  const days = Math.round(hours / 24);
  return plural(days, copy.wait.days, { n: format.number(days) });
}

function headline(f: SyncStatusFormatters, status: ConnectionSyncStatus): string {
  const { copy, plural } = f;
  if (status.status === 'unknown') {
    return copy.headline.unknown;
  }
  if (status.status === 'failing') {
    return copy.headline.failing;
  }
  if (status.queuedCount === 0) {
    return copy.headline.empty;
  }
  const params = {
    n: formatCount(f.format, status.queuedCount),
    wait: status.oldestQueuedWaitMs === null ? '' : formatWait(f, status.oldestQueuedWaitMs),
  };
  const withOldest = status.oldestQueuedWaitMs !== null;

  if (status.status === 'draining') {
    const sentence = plural(
      status.queuedCount,
      withOldest ? copy.headline.shrinkingOldest : copy.headline.shrinking,
      params,
    );
    if (status.estimatedClearanceMs === null) return sentence;
    const clearance = interpolate(copy.headline.clearance, {
      wait: formatWait(f, status.estimatedClearanceMs),
    });
    return `${sentence} ${clearance}`;
  }
  return plural(
    status.queuedCount,
    withOldest ? copy.headline.notShrinkingOldest : copy.headline.notShrinking,
    params,
  );
}

export function ConnectionSyncStatusPanel({
  connectionId,
}: ConnectionSyncStatusPanelProps): ReactElement {
  const copy = useMessages('connections').connectionSyncStatusPanel;
  const format = useFormat();
  const plural = usePlural();
  const f: SyncStatusFormatters = { copy, format, plural };
  const statusQuery = useConnectionSyncStatusQuery(connectionId);
  const data = statusQuery.data;

  return (
    <div className="panel panel--dense">
      <div className="panel__header">
        <div>
          <p className="eyebrow">{copy.eyebrow}</p>
          <h3 className="section-title">{copy.title}</h3>
        </div>
        {data ? (
          <span className="panel__meta">
            <StatusBadge tone={STATUS_TONE[data.status]}>{copy.statusLabels[data.status]}</StatusBadge>
          </span>
        ) : null}
      </div>

      {statusQuery.isLoading ? (
        <LoadingState
          title={copy.loadingTitle}
          message={copy.loadingMessage}
        />
      ) : null}

      {statusQuery.error ? (
        <ErrorState
          title={copy.errorTitle}
          message={describeApiError(statusQuery.error, 'connections')}
          action={
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void statusQuery.refetch()}
            >
              {copy.retry}
            </button>
          }
        />
      ) : null}

      {data ? (
        <>
          {data.alerting ? (
            <Alert tone="error" title={copy.behindTitle}>
              {copy.behindMessage}
            </Alert>
          ) : null}

          <p className="connection-sync-status__headline">{headline(f, data)}</p>

          {data.deadCount > 0 ? (
            <p className="connection-sync-status__note">
              {plural(data.deadCount, copy.dead, { n: formatCount(format, data.deadCount) })}
            </p>
          ) : null}

          {data.runningCount > 0 && data.drainRatePerHour === 0 ? (
            <p className="connection-sync-status__note">
              {plural(data.runningCount, copy.stalled, {
                n: formatCount(format, data.runningCount),
              })}
            </p>
          ) : null}

          <details className="connection-sync-status__details">
            <summary>{copy.details.summary}</summary>
            <dl className="definition-list">
              <div>
                <dt>{copy.details.runningNow}</dt>
                <dd>{formatCount(format, data.runningCount)}</dd>
              </div>
              <div>
                <dt>{copy.details.waitingToRetry}</dt>
                <dd>{formatCount(format, data.deferredCount)}</dd>
              </div>
              <div>
                <dt>{copy.details.lastSuccess}</dt>
                <dd>
                  {data.lastSucceededAt === null
                    ? copy.details.noSuccess
                    : format.dateTime(data.lastSucceededAt)}
                </dd>
              </div>
              <div>
                <dt>{copy.details.newWork}</dt>
                <dd>{formatRate(f, data.arrivalRatePerHour)}</dd>
              </div>
              <div>
                <dt>{copy.details.finishedWork}</dt>
                <dd>{formatRate(f, data.drainRatePerHour)}</dd>
              </div>
              <div>
                <dt>{copy.details.alertAbove}</dt>
                <dd>
                  {data.drainRatePerHour === 0
                    ? copy.details.alertNotMeasured
                    : interpolate(copy.details.alertWaiting, {
                        n: formatCount(format, data.alertThresholdJobs),
                      })}
                </dd>
              </div>
              <div>
                <dt>{copy.details.typicalTaskTime}</dt>
                <dd>
                  {data.averageAttemptDurationMs === null
                    ? copy.details.notMeasured
                    : plural(data.attemptDurationSampleSize, copy.details.taskTime, {
                        duration: format.duration(data.averageAttemptDurationMs) ?? '-',
                        n: formatCount(format, data.attemptDurationSampleSize),
                      })}
                </dd>
              </div>
              <div>
                <dt>{copy.details.positionMoved}</dt>
                <dd>
                  {data.lastCursorAdvanceAt === null
                    ? copy.details.noPosition
                    : format.dateTime(data.lastCursorAdvanceAt)}
                </dd>
              </div>
            </dl>
            <p className="connection-sync-status__note">
              {copy.details.note}
            </p>
          </details>
        </>
      ) : null}
    </div>
  );
}
