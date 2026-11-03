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
import { formatAmount } from '../../../shared/format/format-amount';
import { formatDateTime, formatAbsoluteTime } from '../../../shared/format/format-date';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { Chip, type ChipTone } from '../../../shared/ui/chip';
import { EmptyState } from '../../../shared/ui/feedback-state';
import { StatusBadge } from '../../../shared/ui/status-badge';
import type { BatchQueueEntry, BatchRun, BatchRunItem } from '../api/sales-document-batch.types';
import { useStartSalesDocumentBatchRunMutation } from '../hooks/use-start-sales-document-batch-run-mutation';
import {
  buildBatchQueueRows,
  countBatchQueueRows,
  describeRunNowError,
  filterBatchQueueRows,
  type BatchQueueFilter,
  type BatchQueueRow,
} from '../lib/batch-queue-rows';
import { describeItemDetail, describeItemOutcome, formatElapsed } from '../lib/describe-batch-run';

const KIND_BADGE: Record<string, { label: string; tone: 'info' | 'neutral' }> = {
  invoice: { label: 'Invoice', tone: 'info' },
  'fiscal-receipt': { label: 'Fiscal receipt', tone: 'neutral' },
};

const CHIPS: ReadonlyArray<{ filter: BatchQueueFilter; label: string; tone: ChipTone }> = [
  { filter: 'all', label: 'All', tone: 'neutral' },
  { filter: 'invoice', label: 'Invoice', tone: 'info' },
  { filter: 'fiscal-receipt', label: 'Fiscal receipt', tone: 'neutral' },
  { filter: 'blocked', label: 'Blocked', tone: 'warning' },
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
  const badge = KIND_BADGE[kind] ?? { label: kind, tone: 'neutral' as const };
  return (
    <StatusBadge tone={badge.tone} compact>
      {badge.label}
    </StatusBadge>
  );
}

function orderLabel(orderId: string, entry: BatchQueueEntry | null, item?: BatchRunItem): string {
  return entry?.orderNumber ?? item?.orderNumber ?? orderId;
}

export function BatchQueueTab(props: BatchQueueTabProps): ReactElement {
  const { connectionId, providerName, queue, runningRun } = props;
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
      title={props.runDisabledReason ?? (queue.length === 0 ? 'Nothing to run' : undefined)}
    >
      {startRun.isPending || props.awaitingRun ? 'Starting…' : 'Run now'}
    </Button>
  );

  return (
    <div className="batch-queue">
      {startRun.error ? <Alert tone="error">{describeRunNowError(startRun.error)}</Alert> : null}
      {props.awaitingRun ? (
        <Alert tone="info">The run has been queued and starts in a moment.</Alert>
      ) : null}
      <div className="toolbar page-summary batch-queue__toolbar">
        {rows.length > 0 ? (
          <div className="toolbar__group" role="group" aria-label="Filter the next batch">
            {CHIPS.map((chip) => (
              <Chip
                key={chip.filter}
                tone={chip.tone}
                active={filter === chip.filter}
                onClick={() => setFilter(chip.filter)}
              >
                {chip.label} · {counts[chip.filter]}
              </Chip>
            ))}
          </div>
        ) : null}
        {props.canRun ? <div className="batch-queue__run">{runButton}</div> : null}
      </div>
      {props.runDisabledReason !== null ? (
        <p className="muted-text">
          {queue.length} {queue.length === 1 ? 'order' : 'orders'} queued, untouched since the last
          successful run.
        </p>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          title="Nothing waiting for the next batch"
          message="Orders appear here once they qualify (paid, or shipped, depending on the market) and this connection is their resolved sales-document connection."
        />
      ) : (
        <>
          <div className="data-table__container">
            <table className="data-table" data-testid="batch-queue-table">
              <caption className="sr-only">Orders in the next batch</caption>
              <thead>
                <tr>
                  <th scope="col">Order</th>
                  <th scope="col">Source</th>
                  <th scope="col">Buyer</th>
                  <th scope="col">Placed</th>
                  <th scope="col" className="data-table__cell--right">
                    Total
                  </th>
                  <th scope="col">Will issue</th>
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
              Showing the first {queue.length} of {props.queueTotal} queued orders.
            </p>
          ) : null}
          <p className="muted-text">
            A batch never creates a second document for an order that already has one. Those show up
            here as Blocked instead of silently dropping out of the queue.
          </p>
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
  const entry = row.entry;
  const item = row.kind === 'blocked' ? row.item : undefined;
  return (
    <tr data-testid="batch-queue-row" data-order-id={row.orderId} data-row-kind={row.kind}>
      <td className="mono-text">{orderLabel(row.orderId, entry, item)}</td>
      <td>{entry ? sourceName(entry.sourceConnectionId) : '—'}</td>
      <td>{entry?.buyerName ?? item?.buyerName ?? '—'}</td>
      <td>{entry?.placedAt ? formatDateTime(entry.placedAt) : '—'}</td>
      <td className="data-table__cell--right">
        {entry?.totalAmount != null
          ? formatAmount(entry.totalAmount, entry.currency ?? undefined)
          : '—'}
      </td>
      <td>
        {row.kind === 'queued' ? (
          <KindBadge kind={row.entry.documentKind} />
        ) : (
          <>
            <StatusBadge tone="warning" compact>
              Blocked
            </StatusBadge>
            <span className="muted-text batch-queue__reason">
              {describeItemDetail(row.item, providerName)}
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
              Running
            </StatusBadge>{' '}
            Run started {formatAbsoluteTime(runningRun.startedAt)}
          </h3>
          <span className="panel__meta">elapsed {elapsed}</span>
        </div>
        <p className="muted-text">
          Processed {runningItems.length} of {total} orders, one at a time. Each order is issued
          under its own lock, so two connections can never issue a document for the same order.
        </p>
        <div
          className="batch-progress"
          role="progressbar"
          aria-label="Batch run progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <div className="batch-progress__fill" style={{ width: `${percent}%` }} />
        </div>
        <div className="batch-schedule-form__actions">
          <Button data-testid="batch-run-now" disabled>
            Run in progress…
          </Button>
          <span className="muted-text">Run now is unavailable until this run finishes.</span>
        </div>
      </div>

      <div className="data-table__container">
        <table className="data-table">
          <caption className="sr-only">Orders in the run in progress</caption>
          <thead>
            <tr>
              <th scope="col">Order</th>
              <th scope="col">Buyer</th>
              <th scope="col">Outcome</th>
              <th scope="col">Detail</th>
            </tr>
          </thead>
          <tbody>
            {runningItems.map((item) => {
              const outcome = describeItemOutcome(item);
              return (
                <tr
                  key={item.orderId}
                  data-testid="batch-run-item"
                  data-order-id={item.orderId}
                  data-outcome={item.outcome}
                >
                  <td className="mono-text">{item.orderNumber ?? item.orderId}</td>
                  <td>{item.buyerName ?? '—'}</td>
                  <td>
                    <StatusBadge tone={outcome.tone} compact>
                      {outcome.label}
                    </StatusBadge>
                  </td>
                  <td>{describeItemDetail(item, providerName)}</td>
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
                <td>{entry.buyerName ?? '—'}</td>
                <td>
                  <span className="muted-text">Queued</span>
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
