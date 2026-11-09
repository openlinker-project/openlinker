/**
 * Sales-document batch screen (#3584, mockup M15)
 *
 * One connection's batch issuing: its schedules (one per document kind,
 * #3582), what the next run will issue, and its run history. Batching changes
 * WHEN a document is created, never WHICH kind: the routing rules still decide
 * invoice or receipt per order.
 *
 * A connection that needs reconnecting (or is not active) cannot issue, so the
 * screen says so above everything else, keeps the queue visible and refuses
 * "Run now" (M15 "unavailable"). The backend refuses the run too; the screen
 * only says it first.
 *
 * @module apps/web/src/features/sales-documents/components
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useWriteAccess } from '../../../shared/auth/use-permission';
import { interpolate, renderRich, useFormat, useMessages } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { ErrorState, LoadingState } from '../../../shared/ui/feedback-state';
import { KeyValueList } from '../../../shared/ui/key-value-list';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../shared/ui/tabs';
import { useConnectionQuery, useConnectionsQuery, type Connection } from '../../connections';
import { useDemoMode } from '../../system';
import type { BatchOverview, BatchRun } from '../api/sales-document-batch.types';
import type { ConcreteDocumentKind } from '../api/sales-documents.types';
import { useBatchCopy } from '../hooks/use-batch-copy';
import {
  BATCH_RUNNING_POLL_MS,
  useSalesDocumentBatchOverviewQuery,
} from '../hooks/use-sales-document-batch-overview-query';
import { useSalesDocumentBatchQueueQuery } from '../hooks/use-sales-document-batch-queue-query';
import { useSalesDocumentBatchRunQuery } from '../hooks/use-sales-document-batch-run-query';
import { useSalesDocumentBatchRunsQuery } from '../hooks/use-sales-document-batch-runs-query';
import { buildBatchQueueRows } from '../lib/batch-queue-rows';
import { resolveBatchScreenState, type BatchScreenTab } from '../lib/batch-screen-state';
import {
  describeRunResult,
  describeRunStatus,
  formatTimeUntil,
  joinSentences,
  type BatchCopy,
} from '../lib/describe-batch-run';
import { BatchQueueTab } from './batch-queue-tab';
import { BatchRunHistoryTab } from './batch-run-history-tab';
import { BatchScheduleForm } from './batch-schedule-form';

/** How long the screen waits for a requested run to appear before giving the button back. */
const AWAIT_RUN_TIMEOUT_MS = 2 * 60 * 1000;

interface SalesDocumentBatchScreenProps {
  connectionId: string;
}

/** Why a run cannot start on this connection, or `null` when it can. */
export function batchUnavailableReason(connection: Connection, copy: BatchCopy): string | null {
  if (connection.status === 'active') return null;
  if (connection.status === 'needs_reauth') return copy.unavailable.reconnectFirst;
  return copy.unavailable.notActive;
}

function sumQueueCounts(counts: Record<string, number>): number {
  let total = 0;
  for (const value of Object.values(counts)) {
    if (typeof value === 'number' && Number.isFinite(value)) total += value;
  }
  return total;
}

function useTickingNow(active: boolean): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!active) return undefined;
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

export function SalesDocumentBatchScreen({
  connectionId,
}: SalesDocumentBatchScreenProps): ReactElement {
  const { copy: batchCopy } = useBatchCopy();
  const copy = batchCopy.screen;
  const retry = useMessages('ui').common.retry;
  const demoMode = useDemoMode();
  const write = useWriteAccess('connections:write', demoMode);
  const connection = useConnectionQuery(connectionId);
  // When a "Run now" was accepted and its run has not appeared yet (#3584
  // review): poll so the screen picks the run up, and keep the button disabled.
  const [awaitingRunSince, setAwaitingRunSince] = useState<number | null>(null);
  const overview = useSalesDocumentBatchOverviewQuery(connectionId, {
    pollWhileWaiting: awaitingRunSince !== null,
  });
  const running = overview.data?.runningRun ?? null;
  const poll = running === null && awaitingRunSince === null ? false : BATCH_RUNNING_POLL_MS;
  const queue = useSalesDocumentBatchQueueQuery(connectionId, { refetchInterval: poll });
  const runs = useSalesDocumentBatchRunsQuery(connectionId, { refetchInterval: poll });
  const connections = useConnectionsQuery();
  const lastFinished = (runs.data?.runs ?? []).find((run) => run.status !== 'running') ?? null;
  const lastRunDetail = useSalesDocumentBatchRunQuery(connectionId, lastFinished?.id ?? null);
  const runningDetail = useSalesDocumentBatchRunQuery(connectionId, running?.id ?? null, {
    refetchInterval: poll,
  });
  const now = useTickingNow(running !== null);

  const latestStartedAt = runs.data?.runs[0]?.startedAt ?? null;
  useEffect(() => {
    if (awaitingRunSince === null) return undefined;
    const started =
      running !== null ||
      (latestStartedAt !== null && Date.parse(latestStartedAt) >= awaitingRunSince);
    if (started) {
      setAwaitingRunSince(null);
      return undefined;
    }
    // A run that never appears (the worker is down) must not lock the button
    // for good; the operator gets it back and can look at the jobs page.
    const id = window.setTimeout(() => setAwaitingRunSince(null), AWAIT_RUN_TIMEOUT_MS);
    return () => window.clearTimeout(id);
  }, [awaitingRunSince, running, latestStartedAt]);
  const [tab, setTab] = useState<BatchScreenTab>('schedule');

  const sourceNames = useMemo(
    () => new Map((connections.data ?? []).map((item) => [item.id, item.name])),
    [connections.data]
  );

  if (connection.isLoading || overview.isLoading) {
    return <LoadingState title={copy.loadingTitle} message={copy.loadingMessage} />;
  }
  if (connection.error || overview.error || !connection.data || !overview.data) {
    return (
      <ErrorState
        title={copy.errorTitle}
        message={(connection.error ?? overview.error)?.message ?? copy.errorFallback}
        action={
          <Button
            onClick={() => {
              void connection.refetch();
              void overview.refetch();
            }}
          >
            {retry}
          </Button>
        }
      />
    );
  }

  const provider = connection.data;
  const unavailable = batchUnavailableReason(provider, batchCopy);
  const queueTotal = sumQueueCounts(overview.data.queueCounts);
  const queueCount = queueTotal > 0 ? <span className="tabs__count">{queueTotal}</span> : null;
  const queueIsEmpty =
    buildBatchQueueRows(queue.data ?? [], running === null ? lastRunDetail.data?.items ?? [] : [])
      .length === 0;
  const mkState = resolveBatchScreenState({
    tab,
    unavailable: unavailable !== null,
    running: running !== null,
    queueIsEmpty,
  });

  return (
    <div className="batch-screen" data-testid="batch-issuing-screen" data-mk-state={mkState}>
      {unavailable !== null ? <UnavailableAlert connection={provider} /> : null}
      <Tabs value={tab} onValueChange={(value) => setTab(value as BatchScreenTab)}>
        <TabsList aria-label={copy.tabsLabel}>
          <TabsTrigger value="schedule">{copy.tabs.schedule}</TabsTrigger>
          <TabsTrigger value="queue">
            {copy.tabs.nextBatch} {queueCount}
          </TabsTrigger>
          <TabsTrigger value="history">{copy.tabs.history}</TabsTrigger>
        </TabsList>
        <TabsContent value="schedule">
          <ScheduleTab
            connectionId={connectionId}
            overview={overview.data}
            lastRun={lastFinished}
            queueTotal={queueTotal}
            disabled={!write.canWrite}
          />
        </TabsContent>
        <TabsContent value="queue">
          {queue.error ? (
            <ErrorState
              title={copy.queueErrorTitle}
              message={queue.error.message}
              action={<Button onClick={() => void queue.refetch()}>{retry}</Button>}
            />
          ) : queue.isLoading ? (
            <LoadingState title={copy.queueLoadingTitle} message={copy.queueLoadingMessage} />
          ) : (
            <BatchQueueTab
              connectionId={connectionId}
              providerName={provider.name}
              queue={queue.data ?? []}
              queueTotal={queueTotal}
              lastRunItems={lastRunDetail.data?.items ?? []}
              runningRun={running}
              runningItems={runningDetail.data?.items ?? []}
              sourceName={(id) => sourceNames.get(id) ?? copy.unknownSource}
              runDisabledReason={unavailable}
              canRun={write.canWrite}
              awaitingRun={awaitingRunSince !== null}
              onRunRequested={() => setAwaitingRunSince(Date.now())}
              now={now}
            />
          )}
        </TabsContent>
        <TabsContent value="history">
          {runs.error ? (
            <ErrorState
              title={copy.historyErrorTitle}
              message={runs.error.message}
              action={<Button onClick={() => void runs.refetch()}>{retry}</Button>}
            />
          ) : runs.isLoading ? (
            <LoadingState title={copy.historyLoadingTitle} message={copy.historyLoadingMessage} />
          ) : (
            <BatchRunHistoryTab
              connectionId={connectionId}
              providerName={provider.name}
              runs={runs.data?.runs ?? []}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function UnavailableAlert({ connection }: { connection: Connection }): ReactElement {
  const copy = useBatchCopy().copy.unavailable;
  const needsReauth = connection.status === 'needs_reauth';
  const name = { name: connection.name };
  return (
    <Alert
      tone="error"
      data-testid="batch-unavailable-alert"
      title={interpolate(needsReauth ? copy.titleNeedsReauth : copy.titleNotActive, name)}
      action={
        <Link className="button button--secondary button--sm" to={`/connections/${connection.id}`}>
          {copy.goToConnection}
        </Link>
      }
    >
      {needsReauth
        ? joinSentences(copy.authFailed, copy.runsFailUntilReconnected, copy.queueUnchanged)
        : joinSentences(copy.runsFailUntilActive, copy.queueUnchanged)}
    </Alert>
  );
}

const KIND_ORDER: readonly ConcreteDocumentKind[] = ['invoice', 'fiscal-receipt'];

function ScheduleTab({
  connectionId,
  overview,
  lastRun,
  queueTotal,
  disabled,
}: {
  connectionId: string;
  overview: BatchOverview;
  lastRun: BatchRun | null;
  queueTotal: number;
  disabled: boolean;
}): ReactElement {
  const batch = useBatchCopy();
  const { plural } = batch;
  const copy = batch.copy.scheduleTab;
  const format = useFormat();
  const batchedKinds = KIND_ORDER.filter((kind) =>
    overview.schedules.some((schedule) => schedule.documentKind === kind && schedule.batched)
  );
  const nextSlot = overview.schedules
    .filter((schedule) => schedule.batched)
    .flatMap((schedule) => schedule.nextSlots)
    .map((slot) => slot.slotAt)
    .sort()[0];

  if (batchedKinds.length === 0) {
    return (
      <Alert tone="info" title={copy.offTitle}>
        {copy.offNone}{' '}
        {renderRich(copy.offHowTo, {
          link: (text) => <Link to="/settings/sales-documents">{text}</Link>,
        })}
      </Alert>
    );
  }

  const lastRunStatus = lastRun === null ? null : describeRunStatus(lastRun, batch);
  const queued = plural(queueTotal, copy.queued);

  return (
    <div className="batch-schedule">
      <Alert tone="info" title={copy.onTitle}>
        {joinSentences(copy.onQueue, copy.onRouting)}
      </Alert>
      <section className="panel" aria-label={copy.lastAndNext}>
        <div className="panel__header">
          <h3>{copy.lastAndNext}</h3>
        </div>
        <KeyValueList
          items={[
            {
              id: 'next',
              label: copy.nextRun,
              value: nextSlot
                ? interpolate(copy.nextRunValue, {
                    dateTime: format.dateTime(nextSlot),
                    until: formatTimeUntil(nextSlot, new Date(), batch),
                    queued,
                  })
                : interpolate(copy.noSchedule, { queued }),
            },
            {
              id: 'last',
              label: copy.lastRun,
              value:
                lastRun === null || lastRunStatus === null ? (
                  copy.noneYet
                ) : (
                  <>
                    {format.dateTime(lastRun.startedAt)} · {describeRunResult(lastRun, batch)}{' '}
                    <StatusBadge tone={lastRunStatus.tone} compact>
                      {lastRunStatus.label}
                    </StatusBadge>
                  </>
                ),
            },
          ]}
        />
      </section>
      <section className="panel" aria-label={copy.title}>
        <div className="panel__header">
          <h3>{copy.title}</h3>
        </div>
        <p className="muted-text">{copy.intro}</p>
        <div className="batch-schedule__forms">
          {batchedKinds.map((kind) => (
            <BatchScheduleForm
              key={kind}
              connectionId={connectionId}
              kind={kind}
              schedule={overview.schedules.find((schedule) => schedule.documentKind === kind)}
              disabled={disabled}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
