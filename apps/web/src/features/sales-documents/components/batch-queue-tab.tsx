/**
 * Batch queue tab (#3584, mockup M15 "Next batch", "Running", "Empty")
 *
 * What the next run will issue, with "Run now". The chips filter locally
 * (M15 note 7). While a run is in progress the tab shows its progress: the
 * orders the run has recorded so far with their outcome, and the ones still
 * queued. Orders are processed one at a time (each under its own issue lock),
 * so progress is recorded orders over recorded plus still queued.
 *
 * @module apps/web/src/features/sales-documents/components
 */
import { useMemo, useState, type ReactElement } from 'react';
import { interpolate, useFormat } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { Chip, type ChipTone } from '../../../shared/ui/chip';
import { EmptyState } from '../../../shared/ui/feedback-state';
import { StatusBadge } from '../../../shared/ui/status-badge';
import type { BatchQueueEntry, BatchRun, BatchRunItem } from '../api/sales-document-batch.types';
import { useBatchCopy } from '../hooks/use-batch-copy';
import { useStartSalesDocumentBatchRunMutation } from '../hooks/use-start-sales-document-batch-run-mutation';
import {
  buildBatchQueueRows,
  countBatchQueueRows,
  describeRunNowError,
  filterBatchQueueRows,
  type BatchQueueFilter,
  type BatchQueueRow,
} from '../lib/batch-queue-rows';
import {
  BATCH_EMPTY_CELL,
  batchKindKey,
  describeItemDetail,
  describeItemOutcome,
  formatElapsed,
  joinSentences,
  type BatchCopy,
} from '../lib/describe-batch-run';

const CHIPS: ReadonlyArray<{
  filter: BatchQueueFilter;
  label: (copy: BatchCopy) => string;
  tone: ChipTone;
}> = [
  { filter: 'all', label: (copy) => copy.queue.filters.all, tone: 'neutral' },
  { filter: 'invoice', label: (copy) => copy.queue.filters.invoice, tone: 'info' },
  { filter: 'fiscal-receipt', label: (copy) => copy.queue.filters.fiscalReceipt, tone: 'neutral' },
  { filter: 'blocked', label: (copy) => copy.queue.filters.blocked, tone: 'warning' },
];

interface BatchQueueTabProps {
  connectionId: string;
  providerName: string;
  queue: readonly BatchQueueEntry[];
  /** Queued orders per kind from the overview; the total when the fetch was capped. */
  queueTotal: number;
  /** Items of the last finished run; their refusals show as Blocked. */
  lastRunItems: readonly BatchRunItem[];
  runningRun: BatchRun | null;
  runningItems: readonly BatchRunItem[];
  sourceName: (connectionId: string) => string;
  /** Why the run cannot be started, or `null` when it can. */
  runDisabledReason: string | null;
  canRun: boolean;
  /**
   * A "Run now" was accepted and its run has not shown up yet. The job is
   * enqueued but not yet claimed, so the overview still reports no running
   * run; the button stays disabled meanwhile, or a second click would queue a
   * second run behind the first.
   */
  awaitingRun: boolean;
  /** Called once a "Run now" request is accepted. */
  onRunRequested: () => void;
  now: Date;
}

function KindBadge({ kind }: { kind: string }): ReactElement {
  const { copy } = useBatchCopy();
  const key = batchKindKey(kind);
  return (
    <StatusBadge tone={key === 'invoice' ? 'info' : 'neutral'} compact>
      {key === null ? kind : copy.queue.kinds[key]}
    </StatusBadge>
  );
}

function orderLabel(orderId: string, entry: BatchQueueEntry | null, item?: BatchRunItem): string {
  return entry?.orderNumber ?? item?.orderNumber ?? orderId;
}

export function BatchQueueTab(props: BatchQueueTabProps): ReactElement {
  const { connectionId, providerName, queue, runningRun } = props;
  const batch = useBatchCopy();
  const { copy: batchCopy, plural } = batch;
  const copy = batchCopy.queue;
  const [filter, setFilter] = useState<BatchQueueFilter>('all');
  const startRun = useStartSalesDocumentBatchRunMutation(connectionId);

  const rows = useMemo(
    () => buildBatchQueueRows(queue, runningRun === null ? props.lastRunItems : []),
    [queue, runningRun, props.lastRunItems]
  );
  const counts = countBatchQueueRows(rows);
  const visible = filterBatchQueueRows(rows, filter);

  if (runningRun !== null) {
    return <RunningView {...props} runningRun={runningRun} />;
  }

  const runButton = (
    <Button
      data-testid="batch-run-now"
      onClick={() => startRun.mutate(undefined, { onSuccess: props.onRunRequested })}
      disabled={
        !props.canRun ||
        props.runDisabledReason !== null ||
        queue.length === 0 ||
        startRun.isPending ||
        props.awaitingRun
      }
      title={props.runDisabledReason ?? (queue.length === 0 ? copy.nothingToRun : undefined)}
    >
      {startRun.isPending || props.awaitingRun ? copy.starting : copy.runNow}
    </Button>
  );

  return (
    <div className="batch-queue">
      {startRun.error ? (
        <Alert tone="error">{describeRunNowError(startRun.error, batchCopy)}</Alert>
      ) : null}
      {props.awaitingRun ? <Alert tone="info">{copy.runQueued}</Alert> : null}
      <div className="toolbar page-summary batch-queue__toolbar">
        {rows.length > 0 ? (
          <div className="toolbar__group" role="group" aria-label={copy.filterLabel}>
            {CHIPS.map((chip) => (
              <Chip
                key={chip.filter}
                tone={chip.tone}
                active={filter === chip.filter}
                onClick={() => setFilter(chip.filter)}
              >
                {interpolate(copy.chip, {
                  label: chip.label(batchCopy),
                  count: counts[chip.filter],
                })}
              </Chip>
            ))}
          </div>
        ) : null}
        {props.canRun ? <div className="batch-queue__run">{runButton}</div> : null}
      </div>
      {props.runDisabledReason !== null ? (
        <p className="muted-text">{plural(queue.length, copy.untouched)}</p>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState title={copy.emptyTitle} message={copy.emptyMessage} />
      ) : (
        <>
          <div className="data-table__container">
            <table className="data-table" data-testid="batch-queue-table">
              <caption className="sr-only">{copy.caption}</caption>
              <thead>
                <tr>
                  <th scope="col">{copy.columns.order}</th>
                  <th scope="col">{copy.columns.source}</th>
                  <th scope="col">{copy.columns.buyer}</th>
                  <th scope="col">{copy.columns.placed}</th>
                  <th scope="col" className="data-table__cell--right">
                    {copy.columns.total}
                  </th>
                  <th scope="col">{copy.columns.willIssue}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <QueueRow
                    key={row.orderId}
                    row={row}
                    sourceName={props.sourceName}
                    providerName={providerName}
                  />
                ))}
              </tbody>
            </table>
          </div>
          {queue.length < props.queueTotal ? (
            <p className="muted-text">
              {interpolate(copy.showingFirst, { shown: queue.length, total: props.queueTotal })}
            </p>
          ) : null}
          <p className="muted-text">{joinSentences(copy.noSecondDocument, copy.blockedNote)}</p>
        </>
      )}
    </div>
  );
}

function QueueRow({
  row,
  sourceName,
  providerName,
}: {
  row: BatchQueueRow;
  sourceName: (connectionId: string) => string;
  providerName: string;
}): ReactElement {
  const batch = useBatchCopy();
  const format = useFormat();
  const entry = row.entry;
  const item = row.kind === 'blocked' ? row.item : undefined;
  return (
    <tr data-testid="batch-queue-row" data-order-id={row.orderId} data-row-kind={row.kind}>
      <td className="mono-text">{orderLabel(row.orderId, entry, item)}</td>
      <td>{entry ? sourceName(entry.sourceConnectionId) : BATCH_EMPTY_CELL}</td>
      <td>{entry?.buyerName ?? item?.buyerName ?? BATCH_EMPTY_CELL}</td>
      <td>{entry?.placedAt ? format.dateTime(entry.placedAt) : BATCH_EMPTY_CELL}</td>
      <td className="data-table__cell--right">
        {entry?.totalAmount != null
          ? format.money(entry.totalAmount, entry.currency ?? undefined)
          : BATCH_EMPTY_CELL}
      </td>
      <td>
        {row.kind === 'queued' ? (
          <KindBadge kind={row.entry.documentKind} />
        ) : (
          <>
            <StatusBadge tone="warning" compact>
              {batch.copy.queue.blocked}
            </StatusBadge>
            <span className="muted-text batch-queue__reason">
              {describeItemDetail(row.item, providerName, batch)}
            </span>
          </>
        )}
      </td>
    </tr>
  );
}

function RunningView({
  queue,
  runningRun,
  runningItems,
  providerName,
  now,
}: BatchQueueTabProps & { runningRun: BatchRun }): ReactElement {
  const batch = useBatchCopy();
  const { copy: batchCopy, plural } = batch;
  const copy = batchCopy.running;
  const format = useFormat();
  const processedIds = new Set(runningItems.map((item) => item.orderId));
  const waiting = queue.filter((entry) => !processedIds.has(entry.orderId));
  const total = runningItems.length + waiting.length;
  const percent = total === 0 ? 0 : Math.round((runningItems.length / total) * 100);
  const elapsed = formatElapsed(now.getTime() - Date.parse(runningRun.startedAt));

  return (
    <div className="batch-queue">
      <div className="panel" aria-live="polite" data-testid="batch-run-progress">
        <div className="panel__header">
          <h3>
            <StatusBadge tone="info" pulse>
              {copy.badge}
            </StatusBadge>{' '}
            {interpolate(copy.startedAt, { time: format.time(runningRun.startedAt) })}
          </h3>
          <span className="panel__meta">{interpolate(copy.elapsed, { elapsed })}</span>
        </div>
        <p className="muted-text">
          {joinSentences(
            plural(total, copy.processed, { done: runningItems.length }),
            copy.lockNote
          )}
        </p>
        <div
          className="batch-progress"
          role="progressbar"
          aria-label={copy.progressLabel}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <div className="batch-progress__fill" style={{ width: `${percent}%` }} />
        </div>
        <div className="batch-schedule-form__actions">
          <Button data-testid="batch-run-now" disabled>
            {copy.inProgress}
          </Button>
          <span className="muted-text">{copy.runNowUnavailable}</span>
        </div>
      </div>

      <div className="data-table__container">
        <table className="data-table">
          <caption className="sr-only">{copy.caption}</caption>
          <thead>
            <tr>
              <th scope="col">{batchCopy.itemColumns.order}</th>
              <th scope="col">{batchCopy.itemColumns.buyer}</th>
              <th scope="col">{batchCopy.itemColumns.outcome}</th>
              <th scope="col">{batchCopy.itemColumns.detail}</th>
            </tr>
          </thead>
          <tbody>
            {runningItems.map((item) => {
              const outcome = describeItemOutcome(item, batch);
              return (
                <tr
                  key={item.orderId}
                  data-testid="batch-run-item"
                  data-order-id={item.orderId}
                  data-outcome={item.outcome}
                >
                  <td className="mono-text">{item.orderNumber ?? item.orderId}</td>
                  <td>{item.buyerName ?? BATCH_EMPTY_CELL}</td>
                  <td>
                    <StatusBadge tone={outcome.tone} compact>
                      {outcome.label}
                    </StatusBadge>
                  </td>
                  <td>{describeItemDetail(item, providerName, batch)}</td>
                </tr>
              );
            })}
            {waiting.map((entry) => (
              <tr
                key={entry.orderId}
                data-testid="batch-queue-row"
                data-order-id={entry.orderId}
                data-row-kind="queued"
              >
                <td className="mono-text">{entry.orderNumber ?? entry.orderId}</td>
                <td>{entry.buyerName ?? BATCH_EMPTY_CELL}</td>
                <td>
                  <span className="muted-text">{copy.queued}</span>
                </td>
                <td>
                  <KindBadge kind={entry.documentKind} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
