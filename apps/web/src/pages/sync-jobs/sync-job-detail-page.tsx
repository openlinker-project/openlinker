import type { ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { Alert } from '../../shared/ui/alert';
import { LoadingState, ErrorState } from '../../shared/ui/feedback-state';
import { Button } from '../../shared/ui/button';
import { KeyValueList, type KeyValueItem } from '../../shared/ui/key-value-list';
import { RawPayloadPanel } from '../../shared/ui/raw-payload-panel';
import { TimeDisplay } from '../../shared/ui/time-display';
import { useToast } from '../../shared/ui/toast-provider';
import { SyncJobStatusBadge } from '../../features/sync-jobs/components/SyncJobStatusBadge';
import { useSyncJobQuery } from '../../features/sync-jobs/hooks/use-sync-job-query';
import { useRetrySyncJobMutation } from '../../features/sync-jobs/hooks/use-retry-sync-job-mutation';
import type { SyncJob } from '../../features/sync-jobs/api/sync-jobs.types';
import { ConnectionEntityLabel } from '../../features/connections/components/ConnectionEntityLabel';

function buildSyncJobItems(job: SyncJob): KeyValueItem[] {
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
  return items;
}

export function SyncJobDetailPage(): ReactElement {
  const { id = '' } = useParams<{ id: string }>();
  const query = useSyncJobQuery(id);
  const retry = useRetrySyncJobMutation();
  const { showToast } = useToast();

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
  const isDead = job.status === 'dead';

  function handleRetry(): void {
    retry.mutate(job.id, {
      onSuccess: () => {
        showToast({
          tone: 'success',
          title: 'Retrying',
          description: `Job ${job.id.slice(0, 8)}… requeued.`,
        });
      },
      onError: (error) => {
        showToast({ tone: 'error', title: 'Retry failed', description: error.message });
      },
    });
  }

  return (
    <PageLayout
      backTo={{ to: '/jobs-logs', label: 'Jobs & Logs' }}
      eyebrow="Sync Jobs"
      title={<span className="mono-text">{job.jobType}</span>}
    >
      {isDead ? (
        <Alert
          tone="error"
          title={`Job failed after ${job.attempts} attempt${job.attempts === 1 ? '' : 's'}`}
          action={
            <Button onClick={handleRetry} disabled={retry.isPending}>
              {retry.isPending ? 'Retrying…' : 'Retry'}
            </Button>
          }
        >
          {job.lastError ? (
            <span className="mono-text">
              {job.lastError.length > 240 ? `${job.lastError.slice(0, 240)}…` : job.lastError}
            </span>
          ) : (
            'No error message was recorded for this job.'
          )}
        </Alert>
      ) : null}

      <section className="detail-section">
        <KeyValueList items={buildSyncJobItems(job)} />
      </section>

      {job.lastError ? (
        <section className="detail-section">
          <RawPayloadPanel title="Last error" payload={job.lastError} defaultOpen={!isDead} />
        </section>
      ) : null}

      {job.payloadJson ? (
        <section className="detail-section">
          <RawPayloadPanel title="Payload" payload={job.payloadJson} />
        </section>
      ) : null}
    </PageLayout>
  );
}
