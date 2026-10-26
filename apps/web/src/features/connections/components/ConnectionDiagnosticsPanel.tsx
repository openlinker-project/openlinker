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
import type { ReactElement } from 'react';
import { useConnectionDiagnosticsQuery } from '../hooks/use-connection-diagnostics-query';
import type { ConnectionDiagnosticsSource, RecentJobSummary } from '../api/connections.types';
import { DataTable, type DataTableColumn } from '../../../shared/ui/data-table';
import { formatDateTime } from '../../../shared/format/format-date';
import { Alert } from '../../../shared/ui/alert';
import { LoadingState, ErrorState } from '../../../shared/ui/feedback-state';
import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';

interface ConnectionDiagnosticsPanelProps {
  connectionId: string;
}

/** Operator-facing name for each source, for the "could not check" notice. */
const SOURCE_LABEL: Record<ConnectionDiagnosticsSource, string> = {
  syncJobs: 'sync jobs',
  fiscalRegistrations: 'fiscal receipts',
  invoices: 'invoices',
};

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

function formatDate(value: string | null): string {
  if (value === null) return 'Never';
  return formatDateTime(value);
}

/**
 * The three states behind an activity timestamp. "Never" is a claim about the
 * operator's data and may only be made when every source was actually read.
 */
function formatActivityDate(value: string | null, sourcesUnreadable: boolean): string {
  if (value !== null) return formatDateTime(value);
  return sourcesUnreadable ? 'Unknown' : 'Never';
}

function describeUnreadable(sources: ConnectionDiagnosticsSource[]): string {
  // The fallback keeps an unrecognised source visible rather than printing
  // `undefined`: the API's vocabulary is closed today, but this mirror of it
  // is a copy, and a copy can fall behind.
  const labels = sources.map((source) => SOURCE_LABEL[source] ?? source);
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

const jobColumns: DataTableColumn<RecentJobSummary>[] = [
  { id: 'jobType', header: 'Job type', cell: (row) => <span className="mono-text">{row.jobType}</span> },
  {
    id: 'status',
    header: 'Status',
    cell: (row) => <StatusBadge tone={toJobStatusTone(row.status)}>{row.status}</StatusBadge>,
  },
  { id: 'attempts', header: 'Attempts', align: 'right', cell: (row) => row.attempts },
  { id: 'lastError', header: 'Last error', cell: (row) => row.lastError ?? '-' },
  { id: 'updatedAt', header: 'Updated', cell: (row) => formatDate(row.updatedAt) },
];

export function ConnectionDiagnosticsPanel({ connectionId }: ConnectionDiagnosticsPanelProps): ReactElement {
  const diagnosticsQuery = useConnectionDiagnosticsQuery(connectionId);

  // Absent means the API reported nothing to degrade, which is how every
  // response looked before #3179 — not an unknown of its own.
  const unreadableSources = diagnosticsQuery.data?.unreadableSources ?? [];
  const hasUnreadableSources = unreadableSources.length > 0;

  return (
    <div className="panel panel--dense">
      <div className="panel__header">
        <div>
          <p className="eyebrow">Health</p>
          <h3 className="section-title">Diagnostics</h3>
        </div>
        <span className="panel__meta">Recent activity</span>
      </div>

      {diagnosticsQuery.isLoading ? (
        <LoadingState title="Loading diagnostics" message="Fetching recent job history." />
      ) : null}

      {diagnosticsQuery.error ? (
        <ErrorState
          title="Unable to load diagnostics"
          message={diagnosticsQuery.error.message}
          action={
            <button type="button" className="button button--secondary" onClick={() => void diagnosticsQuery.refetch()}>
              Retry
            </button>
          }
        />
      ) : null}

      {diagnosticsQuery.data ? (
        <>
          {hasUnreadableSources ? (
            <Alert tone="warning" title="Some activity could not be checked">
              We could not read this connection&apos;s {describeUnreadable(unreadableSources)} just
              now, so the times below cover the remaining sources only. Unknown means we do not
              know, not that nothing happened. Try again in a moment.
            </Alert>
          ) : null}

          <dl className="definition-list">
            <div>
              <dt>Last succeeded</dt>
              <dd>
                {formatActivityDate(diagnosticsQuery.data.lastSucceededAt, hasUnreadableSources)}
              </dd>
            </div>
            <div>
              <dt>Last failed</dt>
              <dd>
                {formatActivityDate(diagnosticsQuery.data.lastFailedAt, hasUnreadableSources)}
              </dd>
            </div>
          </dl>

          {diagnosticsQuery.data.recentErrors.length > 0 ? (
            <div className="diagnostics-errors">
              <p className="eyebrow">Recent errors</p>
              <ul className="error-list">
                {diagnosticsQuery.data.recentErrors.map((error, index) => (
                  <li key={`${index}-${error.slice(0, 20)}`} className="mono-text">{error}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <DataTable
            caption="Recent sync jobs"
            columns={jobColumns}
            rows={diagnosticsQuery.data.recentJobs}
            rowKey={(job) => job.id}
          />
        </>
      ) : null}
    </div>
  );
}
