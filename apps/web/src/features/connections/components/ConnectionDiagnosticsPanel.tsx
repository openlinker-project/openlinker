/**
 * Connection Diagnostics Panel
 *
 * Connection detail health-tab panel rendering recent activity for one
 * connection. Presentation only — the read lives in
 * `use-connection-diagnostics-query`.
 *
 * **A source the API could not read is rendered as unknown, never as "Never"**
 * (#3179). The response names any unreadable source in `unreadableSources`, and
 * a null timestamp means two different things on either side of that: genuinely
 * no activity, or a check that did not complete. Printing "Never" for the
 * second tells an operator their working connection has never done anything —
 * the same false claim #3179 exists to remove, from a different cause. It
 * follows `docs/frontend-architecture.md` § Paginated Totals As A Second Stage:
 * idle and unavailable are different, and a surface must render them
 * differently, in visible text rather than a `title`.
 *
 * A timestamp that IS present stays rendered while a source is unreadable — it
 * is a real observation — but the notice above it says the answer may be
 * incomplete, because a more recent success could be sitting in the source that
 * failed to read.
 *
 * @module features/connections/components
 */
import { interpolate, useFormat, useMessages } from '../../../shared/i18n';
import { useMemo, type ReactElement } from 'react';
import { useConnectionDiagnosticsQuery } from '../hooks/use-connection-diagnostics-query';
import type { ConnectionDiagnosticsSource, RecentJobSummary } from '../api/connections.types';
import { DataTable, type DataTableColumn } from '../../../shared/ui/data-table';
import { Alert } from '../../../shared/ui/alert';
import { LoadingState, ErrorState } from '../../../shared/ui/feedback-state';
import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';
import { describeApiError } from '../../../shared/api/describe-api-error';

interface ConnectionDiagnosticsPanelProps {
  connectionId: string;
}

function toJobStatusTone(status: string): StatusBadgeTone {
  switch (status) {
    case 'succeeded':
      return 'success';
    case 'failed':
      return 'error';
    case 'running':
      return 'info';
    case 'queued':
      return 'neutral';
    default:
      return 'neutral';
  }
}

export function ConnectionDiagnosticsPanel({ connectionId }: ConnectionDiagnosticsPanelProps): ReactElement {
  const copy = useMessages('connections').connectionDiagnosticsPanel;
  const format = useFormat();
  const diagnosticsQuery = useConnectionDiagnosticsQuery(connectionId);

  // A missing timestamp says "Never" - unless a source could not be read, in
  // which case absence is not evidence and the honest answer is "Unknown".
  const formatActivityDate = (value: string | null, sourcesUnreadable: boolean): string => {
    if (value !== null) return format.dateTime(value);
    return sourcesUnreadable ? copy.unknown : copy.never;
  };

  const describeUnreadable = (sources: ConnectionDiagnosticsSource[]): string =>
    format.list(sources.map((source) => copy.sourceLabels[source] ?? source));

  const jobColumns = useMemo<DataTableColumn<RecentJobSummary>[]>(
    () => [
      {
        id: 'jobType',
        header: copy.columns.jobType,
        cell: (row) => <span className="mono-text">{row.jobType}</span>,
      },
      {
        id: 'status',
        header: copy.columns.status,
        cell: (row) => (
          <StatusBadge tone={toJobStatusTone(row.status)}>
            {(copy.jobStatuses as Record<string, string>)[row.status] ?? row.status}
          </StatusBadge>
        ),
      },
      { id: 'attempts', header: copy.columns.attempts, align: 'right', cell: (row) => row.attempts },
      { id: 'lastError', header: copy.columns.lastError, cell: (row) => row.lastError ?? '-' },
      {
        id: 'updatedAt',
        header: copy.columns.updated,
        cell: (row) => (row.updatedAt === null ? copy.never : format.dateTime(row.updatedAt)),
      },
    ],
    [copy, format],
  );

  // Absent means the API reported nothing to degrade, which is how every
  // response looked before #3179 — not an unknown of its own.
  const unreadableSources = diagnosticsQuery.data?.unreadableSources ?? [];
  const hasUnreadableSources = unreadableSources.length > 0;

  return (
    <div className="panel panel--dense">
      <div className="panel__header">
        <div>
          <p className="eyebrow">{copy.eyebrow}</p>
          <h3 className="section-title">{copy.title}</h3>
        </div>
        <span className="panel__meta">{copy.meta}</span>
      </div>

      {diagnosticsQuery.isLoading ? (
        <LoadingState title={copy.loadingTitle} message={copy.loadingMessage} />
      ) : null}

      {diagnosticsQuery.error ? (
        <ErrorState
          title={copy.errorTitle}
          message={describeApiError(diagnosticsQuery.error, 'connections')}
          action={
            <button type="button" className="button button--secondary" onClick={() => void diagnosticsQuery.refetch()}>
              {copy.retry}
            </button>
          }
        />
      ) : null}

      {diagnosticsQuery.data ? (
        <>
          {hasUnreadableSources ? (
            <Alert tone="warning" title={copy.unreadableTitle}>
              {interpolate(copy.unreadableMessage, {
                sources: describeUnreadable(unreadableSources),
              })}
            </Alert>
          ) : null}

          <dl className="definition-list">
            <div>
              <dt>{copy.lastSucceeded}</dt>
              <dd>
                {formatActivityDate(diagnosticsQuery.data.lastSucceededAt, hasUnreadableSources)}
              </dd>
            </div>
            <div>
              <dt>{copy.lastFailed}</dt>
              <dd>
                {formatActivityDate(diagnosticsQuery.data.lastFailedAt, hasUnreadableSources)}
              </dd>
            </div>
          </dl>

          {diagnosticsQuery.data.recentErrors.length > 0 ? (
            <div className="diagnostics-errors">
              <p className="eyebrow">{copy.recentErrors}</p>
              <ul className="error-list">
                {diagnosticsQuery.data.recentErrors.map((error, index) => (
                  <li key={`${index}-${error.slice(0, 20)}`} className="mono-text">{error}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <DataTable
            caption={copy.recentJobs}
            columns={jobColumns}
            rows={diagnosticsQuery.data.recentJobs}
            rowKey={(job) => job.id}
          />
        </>
      ) : null}
    </div>
  );
}
