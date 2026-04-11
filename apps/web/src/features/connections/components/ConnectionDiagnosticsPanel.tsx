import type { ReactElement } from 'react';
import { useConnectionDiagnosticsQuery } from '../hooks/use-connection-diagnostics-query';
import type { RecentJobSummary } from '../api/connections.types';
import { DataTable, type DataTableColumn } from '../../../shared/ui/data-table';
import { LoadingState, ErrorState } from '../../../shared/ui/feedback-state';
import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';

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

function formatDate(value: string | null): string {
  if (value === null) return 'Never';
  return new Date(value).toLocaleString();
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
          <dl className="definition-list">
            <div>
              <dt>Last succeeded</dt>
              <dd>{formatDate(diagnosticsQuery.data.lastSucceededAt)}</dd>
            </div>
            <div>
              <dt>Last failed</dt>
              <dd>{formatDate(diagnosticsQuery.data.lastFailedAt)}</dd>
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
