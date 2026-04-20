import type { ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { LoadingState, ErrorState } from '../../shared/ui/feedback-state';
import { Button } from '../../shared/ui/button';
import { KeyValueList, type KeyValueItem } from '../../shared/ui/key-value-list';
import { RawPayloadPanel } from '../../shared/ui/raw-payload-panel';
import { TimeDisplay } from '../../shared/ui/time-display';
import { SyncJobStatusBadge } from '../../features/sync-jobs/components/SyncJobStatusBadge';
import { useSyncJobQuery } from '../../features/sync-jobs/hooks/use-sync-job-query';
import { ConnectionEntityLabel } from '../../features/connections/components/ConnectionEntityLabel';

export function SyncJobDetailPage(): ReactElement {
  const { id = '' } = useParams<{ id: string }>();
  const query = useSyncJobQuery(id);

  if (query.isLoading) {
    return (
      <PageLayout eyebrow="Sync Jobs" title="Job detail">
        <LoadingState liveRegion="off" title="Loading job" message="Fetching job details…" />
      </PageLayout>
    );
  }

  if (query.error || !query.data) {
    return (
      <PageLayout eyebrow="Sync Jobs" title="Job detail">
        <ErrorState
          title="Unable to load job"
          message={query.error?.message ?? 'Job not found'}
          action={
            <Button onClick={() => { void query.refetch(); }}>Retry</Button>
          }
        />
      </PageLayout>
    );
  }

  const job = query.data;

  const items: KeyValueItem[] = [
    { id: 'status', label: 'Status', value: <SyncJobStatusBadge status={job.status} /> },
    { id: 'jobId', label: 'Job ID', value: job.id, mono: true },
    {
      id: 'connection',
      label: 'Connection',
      value: <ConnectionEntityLabel connectionId={job.connectionId} />,
    },
    { id: 'attempts', label: 'Attempts', value: `${job.attempts} / ${job.maxAttempts}` },
    { id: 'nextRun', label: 'Next run at', value: <TimeDisplay iso={job.nextRunAt} /> },
    { id: 'createdAt', label: 'Created', value: <TimeDisplay iso={job.createdAt} /> },
    { id: 'updatedAt', label: 'Updated', value: <TimeDisplay iso={job.updatedAt} /> },
  ];
  if (job.idempotencyKey) {
    items.push({
      id: 'idempotencyKey',
      label: 'Idempotency key',
      value: job.idempotencyKey,
      mono: true,
    });
  }
  if (job.lockedAt) {
    items.push({ id: 'lockedAt', label: 'Locked at', value: <TimeDisplay iso={job.lockedAt} /> });
  }
  if (job.lockedBy) {
    items.push({ id: 'lockedBy', label: 'Locked by', value: job.lockedBy, mono: true });
  }

  return (
    <PageLayout
      eyebrow="Sync Jobs"
      title={<span className="mono-text">{job.jobType}</span>}
      actions={
        <Link to=".." relative="path" className="button button--ghost">
          ← Back to jobs
        </Link>
      }
    >
      {/* Status + metadata */}
      <section className="detail-section">
        <KeyValueList items={items} />
      </section>

      {/* Error section */}
      {job.lastError ? (
        <section className="detail-section">
          <RawPayloadPanel title="Last error" payload={job.lastError} defaultOpen />
        </section>
      ) : null}

      {/* Payload section */}
      {job.payloadJson ? (
        <section className="detail-section">
          <RawPayloadPanel title="Payload" payload={job.payloadJson} />
        </section>
      ) : null}
    </PageLayout>
  );
}
