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
import { formatDateTime } from '../../../shared/format/format-date';
import { Button } from '../../../shared/ui/button';
import { EmptyState, ErrorState, LoadingState } from '../../../shared/ui/feedback-state';
import { MetricCard } from '../../../shared/ui/metric-card';
import { StatusBadge } from '../../../shared/ui/status-badge';
import type { BatchRun } from '../api/sales-document-batch.types';
import { useSalesDocumentBatchRunQuery } from '../hooks/use-sales-document-batch-run-query';
import {
  describeItemDetail,
  describeItemOutcome,
  describeRunResult,
  describeRunStatus,
  formatRunDuration,
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = runs.find((run) => run.id === selectedId) ?? runs[0] ?? null;

  if (runs.length === 0) {
    return (
      <EmptyState
        title="No batch runs yet"
        message="Runs appear here once a scheduled run starts or someone uses Run now."
      />
    );
  }

  return (
    <div className="batch-history">
      <div className="data-table__container">
        <table className="data-table" data-testid="batch-run-history-table">
          <caption className="sr-only">Batch runs, newest first</caption>
          <thead>
            <tr>
              <th scope="col">Started</th>
              <th scope="col">Duration</th>
              <th scope="col" className="data-table__cell--right">
                Orders
              </th>
              <th scope="col">Result</th>
              <th scope="col">Status</th>
              <th scope="col">
                <span className="sr-only">Details</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => {
              const status = describeRunStatus(run);
              const isSelected = selected?.id === run.id;
              return (
                <tr key={run.id} className={isSelected ? 'batch-history__row--current' : undefined}>
                  <td>{formatDateTime(run.startedAt)}</td>
                  <td className="mono-text">{formatRunDuration(run) ?? '-'}</td>
                  <td className="data-table__cell--right">{run.eligibleCount}</td>
                  <td>{describeRunResult(run)}</td>
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
                      Details
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
  const detail = useSalesDocumentBatchRunQuery(connectionId, run.id);
  const title = `${formatDateTime(run.startedAt)}: details`;

  if (detail.isLoading) {
    return <LoadingState title={title} message="Reading each order's outcome." />;
  }
  if (detail.error || detail.data === undefined) {
    return (
      <ErrorState
        title="Unable to load this run"
        message={detail.error?.message ?? 'The run could not be read.'}
        action={<Button onClick={() => void detail.refetch()}>Retry</Button>}
      />
    );
  }

  const items = detail.data.items;
  const summary = summarizeRunItems(items);
  const duration = formatRunDuration(run);

  return (
    <section
      className="panel batch-history__details"
      aria-label="Run details"
      data-testid="batch-run-details"
    >
      <div className="panel__header">
        <h3>{title}</h3>
        <span className="panel__meta">
          {items.length} {items.length === 1 ? 'order' : 'orders'}
          {duration ? ` · ${duration}` : ''}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="muted-text">
          {run.status === 'failed-to-start'
            ? `This run did not start: ${describeRunResult(run)}. Nothing in the queue was touched.`
            : 'This run had nothing to issue.'}
        </p>
      ) : (
        <>
          <div className="batch-history__metrics">
            <MetricCard label="Issued" value={summary.issued} tone="success" />
            <MetricCard label="Blocked" value={summary.blocked} tone="warning" />
            <MetricCard label="Needs attention" value={summary.attention} tone="error" />
          </div>
          {summary.pending > 0 ? (
            <p className="muted-text">
              {summary.pending} still waiting for {providerName} to answer.
            </p>
          ) : null}
          <div className="data-table__container">
            <table className="data-table">
              <caption className="sr-only">Each order in this run and its outcome</caption>
              <thead>
                <tr>
                  <th scope="col">Order</th>
                  <th scope="col">Buyer</th>
                  <th scope="col">Outcome</th>
                  <th scope="col">Detail</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const outcome = describeItemOutcome(item);
                  return (
                    <tr
                      key={item.orderId}
                      data-testid="batch-run-item"
                      data-order-id={item.orderId}
                      data-outcome={item.outcome}
                    >
                      <td className="mono-text">{item.orderNumber ?? item.orderId}</td>
                      <td>{item.buyerName ?? '-'}</td>
                      <td>
                        <StatusBadge tone={outcome.tone} compact>
                          {outcome.label}
                        </StatusBadge>
                      </td>
                      <td
                        className={
                          item.documentNumber && outcome.label === 'Issued'
                            ? 'mono-text'
                            : undefined
                        }
                      >
                        {describeItemDetail(item, providerName)}
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
