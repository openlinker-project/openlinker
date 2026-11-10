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
import {
  interpolate,
  renderRich,
  type Messages,
  type ResolvedCopy,
  useFormat,
  useMessages,
  usePlural,
} from '../../shared/i18n';
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
import { usePlatform } from '../../shared/plugins';
import {
  TERMINAL_BULK_BATCH_STATUSES,
  type BulkBatchRecordSummary,
  type BulkBatchStatus,
} from '../../features/listings/api/bulk-listings.types';
import { serverErrorText } from '../../features/listings/lib/server-error-text';

type BulkBatchProgressCopy = ResolvedCopy<Messages['listings']>['bulkBatchProgressPage'];

export function BulkBatchProgressPage(): ReactElement {
  const { batchId } = useParams<{ batchId: string }>();
  const copy = useMessages('listings').bulkBatchProgressPage;
  const common = useMessages('listings').common;
  const format = useFormat();
  const plural = usePlural();
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
  const batchCopy = useMessages('listings').bulkBatch;
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
        title: copy.toasts.retryDispatchedTitle,
        description: plural(result.retriedCount, copy.toasts.retryDispatchedDescription),
      });
    } catch (error) {
      showToast({
        tone: 'error',
        title: copy.toasts.retryFailedTitle,
        description: serverErrorText(common.serverSaid, (error as Error).message, common.unknownError),
      });
    }
  }, [batchId, common, copy.toasts, plural, retryMutation, showToast]);

  if (!batchId) {
    return (
      <ErrorState
        title={copy.missingIdTitle}
        message={copy.missingIdMessage}
      />
    );
  }

  if (query.isLoading) {
    return (
      <LoadingState
        title={copy.loadingTitle}
        message={copy.loadingMessage}
      />
    );
  }

  if (query.error) {
    return (
      <ErrorState
        title={copy.errorTitle}
        message={serverErrorText(common.serverSaid, query.error.message, common.unknownError)}
        action={
          <Button onClick={() => { void query.refetch(); }}>{copy.retry}</Button>
        }
      />
    );
  }

  if (!query.data) {
    return (
      <ErrorState
        title={copy.notFoundTitle}
        message={interpolate(copy.notFoundMessage, { batchId })}
      />
    );
  }

  const batch = query.data;
  const isTerminal = TERMINAL_BULK_BATCH_STATUSES.includes(batch.status);
  const connectionName =
    connectionsQuery.data?.find((c) => c.id === batch.connectionId)?.name ??
    batch.connectionId;

  const succeededShare = batch.totalCount > 0 ? batch.succeededCount / batch.totalCount : 0;
  const failedShare = batch.totalCount > 0 ? batch.failedCount / batch.totalCount : 0;
  const percentOptions = { maximumFractionDigits: 0 };

  const elapsed = format.duration(elapsedMs(batch.createdAt, batch.updatedAt)) ?? '—';
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
      eyebrow={copy.eyebrow}
      title={renderRich(
        copy.title,
        {
          id: (text) => (
            <span
              className="mono-text"
              style={{ fontSize: 18, color: 'var(--text-muted)', fontWeight: 500 }}
            >
              {text}
            </span>
          ),
        },
        { batchId: batch.id.slice(0, 8) },
      )}
      description={renderRich(
        plural(batch.totalCount, copy.statusLine),
        { status: () => <BatchStatusLabel status={batch.status} copy={copy} /> },
        { connection: connectionName },
      )}
      actions={
        <Link to="/listings" className="button">
          {copy.openListings} <span aria-hidden="true">→</span>
        </Link>
      }
    >
      <div className="bulk-batch__kpi-strip">
        <MetricCard
          label={copy.metrics.total}
          value={format.number(batch.totalCount)}
          description={interpolate(copy.metrics.submitted, {
            when: isValidIso(batch.createdAt) ? format.relativeTime(batch.createdAt) : '—',
          })}
        />
        <MetricCard
          label={interpolate(copy.metrics.succeeded, {
            percent: format.percent(succeededShare, percentOptions),
          })}
          value={format.number(batch.succeededCount)}
          description={copy.metrics.succeededDescription}
          tone="success"
        />
        <MetricCard
          label={interpolate(copy.metrics.failed, {
            percent: format.percent(failedShare, percentOptions),
          })}
          value={format.number(batch.failedCount)}
          description={
            batch.failedCount === 0
              ? copy.metrics.noFailures
              : write.visible
                ? copy.metrics.recoveryAvailable
                : copy.metrics.recoveryNeedsWrite
          }
          tone={batch.failedCount > 0 ? 'error' : 'neutral'}
        />
        <MetricCard
          label={copy.metrics.inProgress}
          value={format.number(inProgress)}
          description={isTerminal ? copy.metrics.batchClosed : copy.metrics.polling}
          tone={inProgress > 0 ? 'info' : 'neutral'}
        />
      </div>

      {!isTerminal ? (
        <Alert tone="info">
          {renderRich(copy.inProgressAlert, { strong: (text) => <strong>{text}</strong> })}
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
              ? plural(batch.failedCount, batchCopy.triage.failedSoFar)
              : batch.succeededCount === 0
                ? plural(batch.failedCount, copy.recovery.allFailed)
                : `${plural(batch.totalCount, copy.recovery.someFailed, {
                    failed: format.number(batch.failedCount),
                  })} ${plural(batch.succeededCount, copy.recovery.someLive)}`}
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
                        {interpolate(batchCopy.accountRefused.providerSaid, { name: connectionName })}{' '}
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
                      <span className="sr-only"> {batchCopy.triage.opensInNewTab}</span>
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
                    {plural(offerFailedCount, batchCopy.triage.offerCause)}
                  </p>
                  <p className="batch-triage__detail">
                    {fixTarget.blocker !== null
                      ? describeBatchFixBlocker(fixTarget.blocker)
                      : batchCopy.triage.offerDetail}
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
                      {interpolate(copy.recovery.fixAndResubmit, { count: format.number(offerFailedCount) })}
                    </Link>
                  ) : (
                    <ReadOnlyLock active={write.demoReadOnly} message={copy.demoLock}>
                      <Button tone="primary" className="button--sm" disabled>
                        {interpolate(copy.recovery.fixAndResubmit, { count: format.number(offerFailedCount) })}
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
                  <p className="batch-triage__cause">{batchCopy.triage.retryCause}</p>
                  <p className="batch-triage__detail">
                    {offerFailedCount === 0 ? batchCopy.recovery.accountOnly : batchCopy.triage.retryDetail}
                  </p>
                </div>
                <div className="batch-triage__action">
                  <ReadOnlyLock active={write.demoReadOnly} message={copy.demoLock}>
                    <Button
                      tone="secondary"
                      className="button--sm"
                      onClick={() => { void handleRetryAll(); }}
                      disabled={!write.canWrite || retryMutation.isPending}
                    >
                      {retryMutation.isPending
                        ? copy.recovery.retrying
                        : interpolate(copy.recovery.retryUnchanged, {
                            count: format.number(batch.failedCount),
                          })}
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
        accountLevelRowLabel={batchCopy.accountRefused.rowPointer}
      />

      {isTerminal ? (
        <div className="bulk-batch__summary">
          <div className="bulk-batch__summary-main">
            <strong>
              {interpolate(
                batch.status === 'completed' ? copy.summary.completedIn : copy.summary.endedIn,
                { elapsed },
              )}
            </strong>{' '}
            <span aria-hidden="true">·</span>{' '}
            {plural(batch.succeededCount, copy.summary.created)}{' '}
            <span aria-hidden="true">·</span>{' '}
            {plural(batch.failedCount, copy.summary.failed)}
          </div>
          <div className="bulk-batch__summary-links">
            <Link to="/listings">
              {copy.openListings} <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      ) : null}
    </PageLayout>
  );
}

function BatchStatusLabel({
  status,
  copy,
}: {
  status: BulkBatchStatus;
  copy: BulkBatchProgressCopy;
}): ReactElement {
  const labels = copy.statuses;
  switch (status) {
    case 'pending':
      return <StatusBadge tone="neutral" withDot>{labels.pending}</StatusBadge>;
    case 'running':
      return <StatusBadge tone="info" withDot pulse>{labels.running}</StatusBadge>;
    case 'completed':
      return <StatusBadge tone="success" withDot>{labels.completed}</StatusBadge>;
    case 'partially-failed':
      return <StatusBadge tone="warning" withDot>{labels.partiallyFailed}</StatusBadge>;
    case 'failed':
      return <StatusBadge tone="error" withDot>{labels.failed}</StatusBadge>;
  }
}

/** Wall time between two stamps, or null when either is unreadable or out of order. */
function elapsedMs(startIso: string, endIso: string): number | null {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return end - start;
}

function isValidIso(iso: string): boolean {
  return !Number.isNaN(new Date(iso).getTime());
}
