import type { ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { LoadingState, ErrorState } from '../../shared/ui/feedback-state';
import { Button } from '../../shared/ui/button';
import { TimeDisplay } from '../../shared/ui/time-display';
import { SyncJobStatusBadge } from '../../features/sync-jobs/components/SyncJobStatusBadge';
import { useSyncJobQuery } from '../../features/sync-jobs/hooks/use-sync-job-query';

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
        <dl className="detail-list">
          <div className="detail-list__row">
            <dt>Status</dt>
            <dd><SyncJobStatusBadge status={job.status} /></dd>
          </div>
          <div className="detail-list__row">
            <dt>Job ID</dt>
            <dd><span className="mono-text">{job.id}</span></dd>
          </div>
          <div className="detail-list__row">
            <dt>Connection</dt>
            <dd><span className="mono-text">{job.connectionId}</span></dd>
          </div>
          <div className="detail-list__row">
            <dt>Attempts</dt>
            <dd>{job.attempts} / {job.maxAttempts}</dd>
          </div>
          <div className="detail-list__row">
            <dt>Next run at</dt>
            <dd><TimeDisplay iso={job.nextRunAt} /></dd>
          </div>
          <div className="detail-list__row">
            <dt>Created</dt>
            <dd><TimeDisplay iso={job.createdAt} /></dd>
          </div>
          <div className="detail-list__row">
            <dt>Updated</dt>
            <dd><TimeDisplay iso={job.updatedAt} /></dd>
          </div>
          {job.idempotencyKey ? (
            <div className="detail-list__row">
              <dt>Idempotency key</dt>
              <dd><span className="mono-text">{job.idempotencyKey}</span></dd>
            </div>
          ) : null}
          {job.lockedAt ? (
            <div className="detail-list__row">
              <dt>Locked at</dt>
              <dd><TimeDisplay iso={job.lockedAt} /></dd>
            </div>
          ) : null}
          {job.lockedBy ? (
            <div className="detail-list__row">
              <dt>Locked by</dt>
              <dd><span className="mono-text">{job.lockedBy}</span></dd>
            </div>
          ) : null}
        </dl>
      </section>

      {/* Error section */}
      {job.lastError ? (
        <section className="detail-section">
          <h3 className="detail-section__title">Last error</h3>
          <pre className="mono-text detail-section__pre">{job.lastError}</pre>
        </section>
      ) : null}

      {/* Payload section */}
      {job.payloadJson ? (
        <section className="detail-section">
          <h3 className="detail-section__title">Payload</h3>
          <pre className="mono-text detail-section__pre">
            {JSON.stringify(job.payloadJson, null, 2)}
          </pre>
        </section>
      ) : null}
    </PageLayout>
  );
}
