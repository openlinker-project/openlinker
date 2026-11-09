/**
 * Batch run history tab (#3584, mockup M15 "Finished")
 *
 * Every run of the connection, newest first, and one run's details: how many
 * orders were issued, blocked or need attention, and each order's outcome.
 * The outcome is read from the order's documents now (ADR-065), so an order
 * whose document was issued after the run reads "Issued", not the state it had
 * when the run ended.
 *
 * @module apps/web/src/features/sales-documents/components
 */
import { useState, type ReactElement } from 'react';
import { interpolate, useFormat, useMessages } from '../../../shared/i18n';
import { Button } from '../../../shared/ui/button';
import { EmptyState, ErrorState, LoadingState } from '../../../shared/ui/feedback-state';
import { MetricCard } from '../../../shared/ui/metric-card';
import { StatusBadge } from '../../../shared/ui/status-badge';
import type { BatchRun } from '../api/sales-document-batch.types';
import { useBatchCopy } from '../hooks/use-batch-copy';
import { useSalesDocumentBatchRunQuery } from '../hooks/use-sales-document-batch-run-query';
import {
  BATCH_EMPTY_CELL,
  describeItemDetail,
  describeItemOutcome,
  describeRunResult,
  describeRunStatus,
  formatRunDuration,
  joinSentences,
  summarizeRunItems,
} from '../lib/describe-batch-run';

interface BatchRunHistoryTabProps {
  connectionId: string;
  providerName: string;
  runs: readonly BatchRun[];
}

export function BatchRunHistoryTab({
  connectionId,
  providerName,
  runs,
}: BatchRunHistoryTabProps): ReactElement {
  const batch = useBatchCopy();
  const copy = batch.copy.history;
  const format = useFormat();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = runs.find((run) => run.id === selectedId) ?? runs[0] ?? null;

  if (runs.length === 0) {
    return <EmptyState title={copy.emptyTitle} message={copy.emptyMessage} />;
  }

  return (
    <div className="batch-history">
      <div className="data-table__container">
        <table className="data-table" data-testid="batch-run-history-table">
          <caption className="sr-only">{copy.caption}</caption>
          <thead>
            <tr>
              <th scope="col">{copy.columns.started}</th>
              <th scope="col">{copy.columns.duration}</th>
              <th scope="col" className="data-table__cell--right">
                {copy.columns.orders}
              </th>
              <th scope="col">{copy.columns.result}</th>
              <th scope="col">{copy.columns.status}</th>
              <th scope="col">
                <span className="sr-only">{copy.columns.details}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => {
              const status = describeRunStatus(run, batch);
              const isSelected = selected?.id === run.id;
              return (
                <tr key={run.id} className={isSelected ? 'batch-history__row--current' : undefined}>
                  <td>{format.dateTime(run.startedAt)}</td>
                  <td className="mono-text">{formatRunDuration(run) ?? BATCH_EMPTY_CELL}</td>
                  <td className="data-table__cell--right">{format.number(run.eligibleCount)}</td>
                  <td>{describeRunResult(run, batch)}</td>
                  <td>
                    <StatusBadge tone={status.tone} compact>
                      {status.label}
                    </StatusBadge>
                  </td>
                  <td>
                    <Button
                      tone="ghost"
                      className="button--sm"
                      aria-pressed={isSelected}
                      onClick={() => setSelectedId(run.id)}
                    >
                      {copy.detailsButton}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {selected !== null ? (
        <BatchRunDetails connectionId={connectionId} providerName={providerName} run={selected} />
      ) : null}
    </div>
  );
}

function BatchRunDetails({
  connectionId,
  providerName,
  run,
}: {
  connectionId: string;
  providerName: string;
  run: BatchRun;
}): ReactElement {
  const batch = useBatchCopy();
  const { copy: batchCopy, plural } = batch;
  const copy = batchCopy.history;
  const retry = useMessages('ui').common.retry;
  const format = useFormat();
  const detail = useSalesDocumentBatchRunQuery(connectionId, run.id);
  const title = interpolate(copy.detailsTitle, { started: format.dateTime(run.startedAt) });

  if (detail.isLoading) {
    return <LoadingState title={title} message={copy.loadingDetail} />;
  }
  if (detail.error || detail.data === undefined) {
    return (
      <ErrorState
        title={copy.errorTitle}
        message={detail.error?.message ?? copy.errorFallback}
        action={<Button onClick={() => void detail.refetch()}>{retry}</Button>}
      />
    );
  }

  const items = detail.data.items;
  const summary = summarizeRunItems(items);
  const duration = formatRunDuration(run);

  return (
    <section
      className="panel batch-history__details"
      aria-label={copy.detailsLabel}
      data-testid="batch-run-details"
    >
      <div className="panel__header">
        <h3>{title}</h3>
        <span className="panel__meta">
          {plural(items.length, copy.orderCount)}
          {duration ? ` · ${duration}` : null}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="muted-text">
          {run.status === 'failed-to-start'
            ? joinSentences(
                interpolate(copy.didNotStart, { reason: describeRunResult(run, batch) }),
                copy.nothingTouched
              )
            : copy.nothingToIssue}
        </p>
      ) : (
        <>
          <div className="batch-history__metrics">
            <MetricCard label={copy.metrics.issued} value={summary.issued} tone="success" />
            <MetricCard label={copy.metrics.blocked} value={summary.blocked} tone="warning" />
            <MetricCard
              label={copy.metrics.needsAttention}
              value={summary.attention}
              tone="error"
            />
          </div>
          {summary.pending > 0 ? (
            <p className="muted-text">
              {plural(summary.pending, copy.pending, { provider: providerName })}
            </p>
          ) : null}
          <div className="data-table__container">
            <table className="data-table">
              <caption className="sr-only">{copy.itemsCaption}</caption>
              <thead>
                <tr>
                  <th scope="col">{batchCopy.itemColumns.order}</th>
                  <th scope="col">{batchCopy.itemColumns.buyer}</th>
                  <th scope="col">{batchCopy.itemColumns.outcome}</th>
                  <th scope="col">{batchCopy.itemColumns.detail}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
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
                      <td
                        className={
                          item.documentNumber && item.outcome === 'issued' ? 'mono-text' : undefined
                        }
                      >
                        {describeItemDetail(item, providerName, batch)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
