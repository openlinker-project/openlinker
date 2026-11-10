import type { ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { describeApiError } from '../../shared/api/describe-api-error';
import { PageLayout } from '../../shared/ui/page-layout';
import { Alert } from '../../shared/ui/alert';
import { LoadingState, ErrorState } from '../../shared/ui/feedback-state';
import { Button } from '../../shared/ui/button';
import { KeyValueList, type KeyValueItem } from '../../shared/ui/key-value-list';
import { RawPayloadPanel } from '../../shared/ui/raw-payload-panel';
import { TimeDisplay } from '../../shared/ui/time-display';
import { formatDurationMs } from '../../shared/format/format-duration-ms';
import { useToast } from '../../shared/ui/toast-provider';
import { SyncJobStatusBadge } from '../../features/sync-jobs/components/SyncJobStatusBadge';
import { useSyncJobQuery } from '../../features/sync-jobs/hooks/use-sync-job-query';
import { useRetrySyncJobMutation } from '../../features/sync-jobs/hooks/use-retry-sync-job-mutation';
import type { SyncJob } from '../../features/sync-jobs/api/sync-jobs.types';
import { ConnectionEntityLabel } from '../../features/connections/components/ConnectionEntityLabel';
import { useConnectionQuery } from '../../features/connections/hooks/use-connection-query';
import { OfferCreationTracker } from '../../features/listings/components/offer-creation-tracker';
import { ReadOnlyLock } from '../../shared/ui/read-only-lock';
import { useWriteAccess } from '../../shared/auth/use-permission';
import { demoReadOnlyActionMessage } from '../../shared/config/demo-mode';
import { useDemoMode } from '../../features/system';
import { jobTypeLabel } from '../../features/sync-jobs/lib/job-type-label';
import { interpolate, usePlural, useMessages, type Messages } from '../../shared/i18n';

type SyncJobDetailCopy = Messages['sync-jobs']['syncJobDetailPage'];

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

function buildSyncJobItems(job: SyncJob, copy: SyncJobDetailCopy['fields']): KeyValueItem[] {
  const items: KeyValueItem[] = [
    {
      id: 'status',
      label: copy.status,
      value: <SyncJobStatusBadge status={job.status} outcome={job.outcome} outcomeReason={job.outcomeReason} />,
    },
    {
      id: 'jobType',
      label: copy.jobType,
      value: <span title={job.jobType}>{jobTypeLabel(job.jobType)}</span>,
    },
    { id: 'jobId', label: copy.jobId, value: job.id, mono: true },
    {
      id: 'connection',
      label: copy.connection,
      value: <ConnectionEntityLabel connectionId={job.connectionId} />,
    },
    { id: 'attempts', label: copy.attempts, value: interpolate(copy.attemptsValue, { attempts: job.attempts, max: job.maxAttempts }) },
    ...(job.outcomeReason
      ? [{ id: 'outcomeReason', label: copy.outcomeReason, value: job.outcomeReason, mono: true }]
      : []),
    { id: 'nextRun', label: copy.nextRun, value: <TimeDisplay iso={job.nextRunAt} /> },
    { id: 'createdAt', label: copy.created, value: <TimeDisplay iso={job.createdAt} /> },
    { id: 'updatedAt', label: copy.updated, value: <TimeDisplay iso={job.updatedAt} /> },
  ];
  if (job.idempotencyKey) {
    items.push({
      id: 'idempotencyKey',
      label: copy.idempotencyKey,
      value: job.idempotencyKey,
      mono: true,
    });
  }
  const duration = formatDurationMs(job.lastAttemptDurationMs);
  if (duration !== null) {
    // Omitted rather than shown as a dash when unmeasured, matching the
    // lockedAt/lockedBy treatment below - a row that says nothing is better
    // than a row that implies the attempt took no time.
    items.push({ id: 'lastAttemptDuration', label: copy.lastAttemptDuration, value: duration });
  }
  const deferred = formatDurationMs(job.deferredTotalMs);
  if (deferred !== null) {
    // A deferral consumes no attempt, so the attempts counter cannot show it.
    // Say so, or a job waiting on a throttling destination reads as stuck.
    items.push({
      id: 'deferredTotal',
      label: copy.deferredTotal,
      value: interpolate(copy.deferredValue, { duration: deferred }),
    });
  }
  if (job.lockedAt) {
    items.push({ id: 'lockedAt', label: copy.lockedAt, value: <TimeDisplay iso={job.lockedAt} /> });
  }
  if (job.lockedBy) {
    items.push({ id: 'lockedBy', label: copy.lockedBy, value: job.lockedBy, mono: true });
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
  const demoMode = useDemoMode();
  // "Retry" fires the retry mutation immediately (a direct-write action, no
  // intermediate form) - visible-but-disabled with a read-only tooltip for a
  // demo viewer, per the #1615 Test connection/Disable connection precedent.
  const write = useWriteAccess('sync:write', demoMode);
  const { showToast } = useToast();
  const copy = useMessages('sync-jobs').syncJobDetailPage;
  const technicalDetails = useMessages('ui').apiError.technicalDetailsWith;
  const plural = usePlural();

  if (query.isLoading) {
    return (
      <PageLayout eyebrow={copy.eyebrow} title={copy.fallbackTitle}>
        <LoadingState liveRegion="off" title={copy.loading.title} message={copy.loading.message} />
      </PageLayout>
    );
  }

  if (query.error || !query.data) {
    return (
      <PageLayout eyebrow={copy.eyebrow} title={copy.fallbackTitle}>
        <ErrorState
          title={copy.error.title}
          message={query.error ? describeApiError(query.error, 'sync-jobs') : copy.error.notFound}
          action={
            <Button onClick={() => { void query.refetch(); }}>{copy.retry}</Button>
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
          title: copy.toast.retrying,
          description: interpolate(copy.toast.requeued, { id: job.id.slice(0, 8) }),
        });
      },
      onError: (error) => {
        showToast({ tone: 'error', title: copy.toast.retryFailed, description: describeApiError(error, 'sync-jobs') });
      },
    });
  }

  return (
    <PageLayout
      backTo={{ to: '/jobs-logs', label: copy.backTo }}
      eyebrow={copy.eyebrow}
      title={jobTypeLabel(job.jobType)}
      description={<span className="mono-text">{job.jobType}</span>}
    >
      {isDead ? (
        <Alert
          tone="error"
          title={plural(job.attempts, copy.failedAfter)}
          action={
            write.visible ? (
              <ReadOnlyLock active={write.demoReadOnly} message={demoReadOnlyActionMessage()}>
                <Button onClick={handleRetry} disabled={retry.isPending || write.demoReadOnly}>
                  {retry.isPending ? copy.retrying : copy.retry}
                </Button>
              </ReadOnlyLock>
            ) : null
          }
        >
          {job.lastError ? (
            <span className="mono-text">
              {interpolate(technicalDetails, {
                details: job.lastError.length > 240 ? `${job.lastError.slice(0, 240)}…` : job.lastError,
              })}
            </span>
          ) : (
            copy.noError
          )}
        </Alert>
      ) : null}

      <section className="detail-section">
        <KeyValueList items={buildSyncJobItems(job, copy.fields)} />
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
          <RawPayloadPanel title={copy.panels.lastError} payload={job.lastError} defaultOpen={!isDead} />
        </section>
      ) : null}

      {job.payloadJson ? (
        <section className="detail-section">
          <RawPayloadPanel title={copy.panels.payload} payload={job.payloadJson} />
        </section>
      ) : null}
    </PageLayout>
  );
}
