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
import { useConnectionQuery } from '../../features/connections/hooks/use-connection-query';
import { OfferCreationTracker } from '../../features/listings/components/OfferCreationTracker';
import { usePermission } from '../../shared/auth/use-permission';

/**
 * Extracts the offer-creation record ID from a `marketplace.offer.create`
 * job payload. The worker enqueue path (`POST /listings/connections/:id/offers`)
 * pre-creates the OfferCreationRecord and threads its id through the job
 * payload so downstream consumers can correlate the job with the business
 * outcome. Returns null when the field is absent or has a non-string shape
 * — both cases render no panel (#391 AC3 "gracefully shows nothing").
 */
function extractOfferCreationRecordId(job: SyncJob): string | null {
  if (job.jobType !== 'marketplace.offer.create' || job.payloadJson === null) {
    return null;
  }
  const candidate = (job.payloadJson as Record<string, unknown>).offerCreationRecordId;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}

function buildSyncJobItems(job: SyncJob): KeyValueItem[] {
  const items: KeyValueItem[] = [
    {
      id: 'status',
      label: 'Status',
      value: <SyncJobStatusBadge status={job.status} outcome={job.outcome} />,
    },
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
  // Connection lookup feeds the OfferCreationTracker's draft branch with
  // platform + environment so it can render the Allegro seller-panel link
  // (#407). The hook self-disables on empty id, so it's safe to call
  // before the loading/error guards below.
  const connectionQuery = useConnectionQuery(query.data?.connectionId ?? '');
  const retry = useRetrySyncJobMutation();
  const canRetry = usePermission('sync:write');
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
  const offerCreationRecordId = extractOfferCreationRecordId(job);

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
            canRetry ? (
              <Button onClick={handleRetry} disabled={retry.isPending}>
                {retry.isPending ? 'Retrying…' : 'Retry'}
              </Button>
            ) : null
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

      {offerCreationRecordId !== null ? (
        <section className="detail-section">
          <OfferCreationTracker
            connectionId={job.connectionId}
            offerCreationRecordId={offerCreationRecordId}
            marketplacePlatformType={connectionQuery.data?.platformType}
            marketplaceEnvironment={
              typeof connectionQuery.data?.config?.environment === 'string'
                ? connectionQuery.data.config.environment
                : undefined
            }
          />
        </section>
      ) : null}

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
