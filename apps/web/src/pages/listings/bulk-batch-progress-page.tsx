/**
 * Bulk batch progress page (#741)
 *
 * Operator lands here after submitting the bulk wizard. Polls
 * `GET /listings/bulk-create/:batchId` every 5 s while non-terminal; stops
 * once status ∈ {completed, partially-failed, failed}. Surfaces aggregate
 * counts, a partially-failed banner with "Retry all failed (N)", per-record
 * statuses, and a final summary card on terminal state.
 *
 * @module apps/web/src/pages/listings
 */
import { useCallback, useMemo, type ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  ErrorState,
  LoadingState,
  MetricCard,
  PageLayout,
  StatusBadge,
} from '../../shared/ui';
import { ReadOnlyLock } from '../../shared/ui/read-only-lock';
import { useToast } from '../../shared/ui/toast-provider';
import { useWriteAccess } from '../../shared/auth/use-permission';
import { useDemoMode } from '../../features/system';
import { BulkBatchProgressTable } from '../../features/listings/components/bulk/bulk-batch-progress-table';
import {
  buildBatchFixUrl,
  describeBatchFixBlocker,
  resolveBatchFixTarget,
  selectFailedRecords,
} from '../../features/listings/lib/batch-recovery';
import { useBulkBatchQuery } from '../../features/listings/hooks/use-bulk-batch-query';
import { useBulkRetryFailedMutation } from '../../features/listings/hooks/use-bulk-retry-failed-mutation';
import { useConnectionsQuery } from '../../features/connections';
import { splitAccountLevelFailures } from '../../features/listings/lib/account-level-failures';
import { interpolate, useFormat, useMessages, usePlural } from '../../shared/i18n';
import { usePlatform } from '../../shared/plugins';
import {
  TERMINAL_BULK_BATCH_STATUSES,
  type BulkBatchRecordSummary,
  type BulkBatchStatus,
} from '../../features/listings/api/bulk-listings.types';

/** Tooltip copy for a demo viewer, matching the wizard's own locked submit. */
const DEMO_LOCK_MESSAGE = 'Read-only demo - recovery actions are disabled.';

export function BulkBatchProgressPage(): ReactElement {
  const { batchId } = useParams<{ batchId: string }>();
  const query = useBulkBatchQuery(batchId);
  const retryMutation = useBulkRetryFailedMutation();
  const connectionsQuery = useConnectionsQuery();
  const { showToast } = useToast();
  const demoMode = useDemoMode();
  // Both recovery actions are writes on the same resource, so they share the
  // gate the wizard's own submit uses (#1615 visible-but-disabled in demo).
  const write = useWriteAccess('listings:write', demoMode);

  const failedRecords = useMemo(
    () => selectFailedRecords(query.data?.records ?? []),
    [query.data],
  );
  const copy = useMessages('listings').bulkBatch;
  const plural = usePlural();
  const { number: formatCount } = useFormat();
  const batchConnection = connectionsQuery.data?.find((c) => c.id === query.data?.connectionId);
  const accountRefusal = usePlatform(batchConnection?.platformType)?.offerValidation
    ?.accountLevelRefusal;
  // Account-level refusals (#4004) are reported once, above the table; only the
  // offer-level failures are something the wizard can fix.
  const split = useMemo(
    () => splitAccountLevelFailures(failedRecords, accountRefusal?.errorCodes ?? []),
    [failedRecords, accountRefusal],
  );
  const accountLevelRecordIds = useMemo(
    () => new Set(split.account.map((r) => r.id)),
    [split],
  );
  const fixTarget = useMemo(() => resolveBatchFixTarget(split.offer), [split]);
  const offerFailedCount = split.offer.length;

  const batchId_ = query.data?.id;
  const batchConnectionId = query.data?.connectionId;
  // Stable identity so the records table doesn't rebuild its column model on
  // every poll tick.
  const buildRowFixUrl = useCallback(
    (record: BulkBatchRecordSummary): string | null => {
      if (batchId_ === undefined || batchConnectionId === undefined) return null;
      const target = resolveBatchFixTarget([record]);
      if (target.blocker !== null) return null;
      return buildBatchFixUrl({
        productIds: target.productIds,
        variantIds: target.variantIds,
        connectionId: batchConnectionId,
        batchId: batchId_,
      });
    },
    [batchId_, batchConnectionId],
  );

  const inProgress = useMemo(() => {
    if (!query.data) return 0;
    return (
      query.data.totalCount -
      query.data.succeededCount -
      query.data.failedCount
    );
  }, [query.data]);

  const handleRetryAll = useCallback(async () => {
    if (!batchId) return;
    try {
      const result = await retryMutation.mutateAsync(batchId);
      showToast({
        tone: 'success',
        title: 'Retry dispatched',
        description: `${result.retriedCount.toLocaleString()} records re-enqueued.`,
      });
    } catch (error) {
      showToast({
        tone: 'error',
        title: 'Retry failed',
        description: (error as Error).message,
      });
    }
  }, [batchId, retryMutation, showToast]);

  if (!batchId) {
    return (
      <ErrorState
        title="Missing batch ID"
        message="The route is missing a batch identifier."
      />
    );
  }

  if (query.isLoading) {
    return (
      <LoadingState
        title="Loading batch"
        message="Fetching bulk batch status…"
      />
    );
  }

  if (query.error) {
    return (
      <ErrorState
        title="Could not load batch"
        message={query.error.message}
        action={
          <Button onClick={() => { void query.refetch(); }}>Retry</Button>
        }
      />
    );
  }

  if (!query.data) {
    return (
      <ErrorState
        title="Batch not found"
        message={`No batch with id "${batchId}" was found.`}
      />
    );
  }

  const batch = query.data;
  const isTerminal = TERMINAL_BULK_BATCH_STATUSES.includes(batch.status);
  const connectionName =
    connectionsQuery.data?.find((c) => c.id === batch.connectionId)?.name ??
    batch.connectionId;

  const succeededPct =
    batch.totalCount > 0
      ? Math.round((batch.succeededCount / batch.totalCount) * 100)
      : 0;
  const failedPct =
    batch.totalCount > 0
      ? Math.round((batch.failedCount / batch.totalCount) * 100)
      : 0;

  const elapsed = computeElapsed(batch.createdAt, batch.updatedAt);
  const accountNotice =
    accountRefusal && split.account.length > 0
      ? accountRefusal.describe({
          affected: split.account.length,
          total: batch.totalCount,
          connectionConfig: batchConnection?.config ?? {},
        })
      : null;
  const showAccountRow = accountNotice !== null;
  const showRecovery = isTerminal && batch.failedCount > 0 && write.visible;

  return (
    <PageLayout
      eyebrow="Operations · Listings"
      title={
        <>
          Bulk batch{' '}
          <span
            className="mono-text"
            style={{ fontSize: 18, color: 'var(--text-muted)', fontWeight: 500 }}
          >
            {batch.id.slice(0, 8)}
          </span>
        </>
      }
      description={
        <>
          Status <BatchStatusLabel status={batch.status} /> · {connectionName}{' '}
          · {batch.totalCount.toLocaleString()} {batch.totalCount === 1 ? 'variant' : 'variants'}
        </>
      }
      actions={
        <Link to="/listings" className="button">
          Open in /listings →
        </Link>
      }
    >
      <div className="bulk-batch__kpi-strip">
        <MetricCard
          label="Total"
          value={batch.totalCount.toLocaleString()}
          description={`Submitted ${formatRelative(batch.createdAt)}`}
        />
        <MetricCard
          label={`Succeeded · ${succeededPct.toString()}%`}
          value={batch.succeededCount.toLocaleString()}
          description="Offers live on marketplace"
          tone="success"
        />
        <MetricCard
          label={`Failed · ${failedPct.toString()}%`}
          value={batch.failedCount.toLocaleString()}
          description={
            batch.failedCount === 0
              ? 'No failures'
              : write.visible
                ? 'Recovery available below'
                : 'Recovery needs write access'
          }
          tone={batch.failedCount > 0 ? 'error' : 'neutral'}
        />
        <MetricCard
          label="In progress"
          value={inProgress.toLocaleString()}
          description={isTerminal ? 'Batch closed' : 'Polling every 5 s'}
          tone={inProgress > 0 ? 'info' : 'neutral'}
        />
      </div>

      {!isTerminal ? (
        <Alert tone="info">
          <strong>Batch in progress.</strong> Polling for updates every 5 seconds.
        </Alert>
      ) : null}

      {/* Recovery bar (#2234). Gated on the terminal-with-failures state, not
          on `partially-failed` alone - a batch where everything failed used to
          render no recovery control at all while the Failed metric card still
          read "Retry available below". The two actions are ranked rather than
          equivalent: a payload the platform rejected cannot be healed by
          re-sending it, so the data fix leads and retry stays one click away
          for the transient case. */}
      {/* What went wrong, by cause (#2234, #4004). One panel instead of stacked
          tinted alerts: each row is one cause with its own count and its own
          action, so an account-level refusal (nothing in the offers can fix
          it) never sits behind the same "Fix and resubmit" as an offer-data
          one. Colour marks only each row's tone. */}
      {showAccountRow || showRecovery ? (
        <section className="batch-triage" aria-labelledby="batch-triage-title">
          <h2 className="batch-triage__title" id="batch-triage-title">
            {!isTerminal
              ? plural(batch.failedCount, copy.triage.failedSoFar)
              : batch.succeededCount === 0
                ? plural(batch.failedCount, copy.triage.failedNothingLive)
                : `${plural(batch.totalCount, copy.triage.failedOfTotal, {
                    failed: formatCount(batch.failedCount),
                  })} ${plural(batch.succeededCount, copy.triage.liveOffers)}`}
          </h2>
          <ul className="batch-triage__list">
            {showAccountRow && accountNotice ? (
              <li className="batch-triage__row batch-triage__row--error" data-testid="bulk-batch-account-refusal">
                <span className="batch-triage__mark" aria-hidden="true" />
                <div className="batch-triage__body">
                  <p className="batch-triage__cause">{accountNotice.title}</p>
                  <p className="batch-triage__detail">{accountNotice.detail}</p>
                  {split.firstAccountError ? (
                    <figure className="batch-triage__quote">
                      <blockquote>{split.firstAccountError.message}</blockquote>
                      <figcaption>
                        {interpolate(copy.accountRefused.providerSaid, { name: connectionName })}{' '}
                        <code>{split.firstAccountError.code}</code>
                      </figcaption>
                    </figure>
                  ) : null}
                </div>
                {accountNotice.action ? (
                  <div className="batch-triage__action">
                    <a
                      className="button button--secondary button--sm"
                      href={accountNotice.action.href}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {accountNotice.action.label}
                      <span aria-hidden="true"> ↗</span>
                      <span className="sr-only"> {copy.triage.opensInNewTab}</span>
                    </a>
                  </div>
                ) : null}
              </li>
            ) : null}
            {showRecovery && offerFailedCount > 0 ? (
              <li className="batch-triage__row batch-triage__row--warning">
                <span className="batch-triage__mark" aria-hidden="true" />
                <div className="batch-triage__body">
                  <p className="batch-triage__cause">
                    {plural(offerFailedCount, copy.triage.offerCause)}
                  </p>
                  <p className="batch-triage__detail">
                    {fixTarget.blocker !== null
                      ? describeBatchFixBlocker(fixTarget.blocker)
                      : copy.triage.offerDetail}
                  </p>
                </div>
                <div className="batch-triage__action">
                  {fixTarget.blocker === null && write.canWrite ? (
                    <Link
                      className="button button--primary button--sm"
                      to={buildBatchFixUrl({
                        productIds: fixTarget.productIds,
                        variantIds: fixTarget.variantIds,
                        connectionId: batch.connectionId,
                        batchId: batch.id,
                      })}
                    >
                      {interpolate(copy.triage.fixAndResubmit, { n: formatCount(offerFailedCount) })}
                    </Link>
                  ) : (
                    <ReadOnlyLock active={write.demoReadOnly} message={DEMO_LOCK_MESSAGE}>
                      <Button tone="primary" className="button--sm" disabled>
                        {interpolate(copy.triage.fixAndResubmit, { n: formatCount(offerFailedCount) })}
                      </Button>
                    </ReadOnlyLock>
                  )}
                </div>
              </li>
            ) : null}
            {showRecovery ? (
              <li className="batch-triage__row batch-triage__row--neutral">
                <span className="batch-triage__mark" aria-hidden="true" />
                <div className="batch-triage__body">
                  <p className="batch-triage__cause">{copy.triage.retryCause}</p>
                  <p className="batch-triage__detail">
                    {offerFailedCount === 0 ? copy.recovery.accountOnly : copy.triage.retryDetail}
                  </p>
                </div>
                <div className="batch-triage__action">
                  <ReadOnlyLock active={write.demoReadOnly} message={DEMO_LOCK_MESSAGE}>
                    <Button
                      tone="secondary"
                      className="button--sm"
                      onClick={() => { void handleRetryAll(); }}
                      disabled={!write.canWrite || retryMutation.isPending}
                    >
                      {retryMutation.isPending
                        ? copy.triage.retrying
                        : interpolate(copy.triage.retryUnchanged, { n: formatCount(batch.failedCount) })}
                    </Button>
                  </ReadOnlyLock>
                </div>
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}

      <BulkBatchProgressTable
        records={batch.records}
        buildFixUrl={write.canWrite ? buildRowFixUrl : undefined}
        accountLevelRecordIds={accountLevelRecordIds}
        accountLevelRowLabel={copy.accountRefused.rowPointer}
      />

      {isTerminal ? (
        <div className="bulk-batch__summary">
          <div className="bulk-batch__summary-main">
            <strong>
              Batch {batch.status === 'completed' ? 'completed' : 'ended'} in {elapsed}
            </strong>{' '}
            · {batch.succeededCount.toLocaleString()} created · {batch.failedCount.toLocaleString()} failed
          </div>
          <div className="bulk-batch__summary-links">
            <Link to="/listings">Open in /listings →</Link>
          </div>
        </div>
      ) : null}
    </PageLayout>
  );
}

function BatchStatusLabel({
  status,
}: {
  status: BulkBatchStatus;
}): ReactElement {
  switch (status) {
    case 'pending':
      return <StatusBadge tone="neutral" withDot>pending</StatusBadge>;
    case 'running':
      return <StatusBadge tone="info" withDot pulse>running</StatusBadge>;
    case 'completed':
      return <StatusBadge tone="success" withDot>completed</StatusBadge>;
    case 'partially-failed':
      return <StatusBadge tone="warning" withDot>partially failed</StatusBadge>;
    case 'failed':
      return <StatusBadge tone="error" withDot>failed</StatusBadge>;
  }
}

function computeElapsed(startIso: string, endIso: string): string {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return '—';
  const seconds = Math.round((end - start) / 1000);
  if (seconds < 60) return `${seconds.toString()}s`;
  const minutes = Math.floor(seconds / 60);
  const remSeconds = seconds % 60;
  return remSeconds > 0
    ? `${minutes.toString()}m ${remSeconds.toString()}s`
    : `${minutes.toString()}m`;
}

function formatRelative(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds.toString()}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes.toString()} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours.toString()} h ago`;
}
