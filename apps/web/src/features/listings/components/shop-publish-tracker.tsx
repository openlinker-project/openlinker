/**
 * ShopPublishTracker
 *
 * Polls a shop-publish record (single) or batch (bulk) until terminal status
 * and renders progress (#1044). Rendered inside the launcher Dialog after
 * the wizard submits.
 *
 *   - **single** (`recordId` + `connectionId`) → `useShopPublishStatusQuery`,
 *     a small stepper (pending → publishing → published/draft). Failed shows
 *     the error code + message; success shows the external product id.
 *   - **bulk** (`batchId`) → `useBulkShopPublishBatchQuery`, batch progress
 *     (succeeded+failed/total, ok/fail progress bar, per-record rows).
 *
 * @module apps/web/src/features/listings/components
 */
import type { ReactElement } from 'react';
import { Alert } from '../../../shared/ui/alert';
import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';
import { useShopPublishStatusQuery } from '../hooks/use-shop-publish-status-query';
import { useBulkShopPublishBatchQuery } from '../hooks/use-bulk-shop-publish-batch-query';
import type { ShopPublishStatus, ShopPublishStatusResponse } from '../api/listings.types';

interface ShopPublishTrackerProps {
  connectionId: string;
  recordId?: string;
  batchId?: string;
}

function statusTone(status: ShopPublishStatus): StatusBadgeTone {
  switch (status) {
    case 'published':
      return 'success';
    case 'draft':
      return 'neutral';
    case 'failed':
      return 'error';
    default:
      return 'info';
  }
}

function statusLabel(status: ShopPublishStatus): string {
  switch (status) {
    case 'published':
      return 'Published';
    case 'draft':
      return 'Draft';
    case 'failed':
      return 'Failed';
    default:
      return 'Publishing';
  }
}

function SingleTracker({
  connectionId,
  recordId,
}: {
  connectionId: string;
  recordId: string;
}): ReactElement {
  const query = useShopPublishStatusQuery(connectionId, recordId);

  if (query.isLoading) {
    return (
      <section className="shop-publish-tracker" aria-live="polite">
        <p className="muted-text">Loading status…</p>
      </section>
    );
  }

  if (query.error || !query.data) {
    return (
      <section className="shop-publish-tracker" aria-live="polite">
        <p className="muted-text">
          {query.error ? `Unable to load status: ${query.error.message}` : 'No status available.'}
        </p>
      </section>
    );
  }

  const record = query.data;
  const isTerminal = record.status === 'published' || record.status === 'draft';
  const queued = true;
  const publishing = record.status !== 'pending';
  const live = isTerminal;

  return (
    <section
      className={`shop-publish-tracker shop-publish-tracker--${record.status}`}
      aria-live="polite"
    >
      <div className="shop-publish-tracker__header">
        <span className="shop-publish-tracker__title">
          {record.status === 'failed' ? 'Publish failed' : isTerminal ? 'Published' : 'Publishing…'}
        </span>
        <StatusBadge tone={statusTone(record.status)} withDot pulse={record.status === 'pending'}>
          {statusLabel(record.status)}
        </StatusBadge>
      </div>

      {record.status === 'failed' ? (
        <Alert
          tone="error"
          title={
            record.errors && record.errors.length > 0 ? (
              <span className="mono-text">{record.errors[0].code}</span>
            ) : (
              'Publish failed'
            )
          }
        >
          {record.errors && record.errors.length > 0
            ? record.errors[0].message
            : 'Publishing failed. No product was created on the shop.'}
        </Alert>
      ) : (
        <ol className="shop-publish-stepper">
          <li
            className={`shop-publish-stepper__step${queued ? ' shop-publish-stepper__step--done' : ''}`}
          >
            <span className="shop-publish-stepper__dot" aria-hidden="true" />
            <span className="shop-publish-stepper__label">Queued</span>
          </li>
          <li
            className={`shop-publish-stepper__step${
              live
                ? ' shop-publish-stepper__step--done'
                : publishing
                  ? ' shop-publish-stepper__step--current'
                  : ''
            }`}
          >
            <span className="shop-publish-stepper__dot" aria-hidden="true" />
            <span className="shop-publish-stepper__label">Publishing to WooCommerce</span>
          </li>
          <li
            className={`shop-publish-stepper__step${live ? ' shop-publish-stepper__step--done' : ''}`}
          >
            <span className="shop-publish-stepper__dot" aria-hidden="true" />
            <span className="shop-publish-stepper__label">
              {record.status === 'draft' ? 'Created as draft' : 'Live on storefront'}
            </span>
          </li>
        </ol>
      )}

      {isTerminal && record.externalProductId ? (
        <dl className="shop-publish-kv">
          <div className="shop-publish-kv__row">
            <dt>Product</dt>
            <dd className="mono-text">{record.externalProductId}</dd>
          </div>
        </dl>
      ) : null}
    </section>
  );
}

function recordTone(status: ShopPublishStatusResponse['status']): StatusBadgeTone {
  return statusTone(status);
}

function BulkTracker({ batchId }: { batchId: string }): ReactElement {
  const query = useBulkShopPublishBatchQuery(batchId);

  if (query.isLoading) {
    return (
      <section className="shop-publish-tracker" aria-live="polite">
        <p className="muted-text">Loading batch…</p>
      </section>
    );
  }

  if (query.error || !query.data) {
    return (
      <section className="shop-publish-tracker" aria-live="polite">
        <p className="muted-text">
          {query.error ? `Unable to load batch: ${query.error.message}` : 'No batch available.'}
        </p>
      </section>
    );
  }

  const batch = query.data;
  const done = batch.succeededCount + batch.failedCount;
  const total = batch.totalCount || 1;
  const okPct = (batch.succeededCount / total) * 100;
  const failPct = (batch.failedCount / total) * 100;
  const running = Math.max(0, batch.totalCount - done);

  const batchTone: StatusBadgeTone =
    batch.status === 'completed'
      ? 'success'
      : batch.status === 'failed'
        ? 'error'
        : batch.status === 'partially-failed'
          ? 'warning'
          : 'info';
  const batchLabel =
    batch.status === 'partially-failed'
      ? 'Partially failed'
      : batch.status.charAt(0).toUpperCase() + batch.status.slice(1);

  return (
    <section className="shop-publish-tracker" aria-live="polite">
      <div className="shop-publish-tracker__header">
        <span className="shop-publish-tracker__title">Bulk publish</span>
        <StatusBadge tone={batchTone} withDot pulse={batch.status === 'running'}>
          {batchLabel}
        </StatusBadge>
      </div>

      <div className="shop-publish-batch">
        <div className="shop-publish-batch__top">
          <div className="shop-publish-batch__count tabular">
            {done} / {batch.totalCount}
          </div>
          <div className="shop-publish-batch__legend">
            <span>
              <span className="shop-publish-dot shop-publish-dot--ok" aria-hidden="true" />
              {batch.succeededCount} published
            </span>
            <span>
              <span className="shop-publish-dot shop-publish-dot--fail" aria-hidden="true" />
              {batch.failedCount} failed
            </span>
            {running > 0 ? (
              <span>
                <span className="shop-publish-dot shop-publish-dot--run" aria-hidden="true" />
                {running} running
              </span>
            ) : null}
          </div>
        </div>
        <div
          className="shop-publish-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={batch.totalCount}
          aria-valuenow={done}
        >
          <div className="shop-publish-progress__ok" style={{ width: `${okPct}%` }} />
          <div className="shop-publish-progress__fail" style={{ width: `${failPct}%` }} />
        </div>
        <div className="shop-publish-batch__rows">
          {batch.records.map((record) => (
            <div key={record.id} className="shop-publish-batch__row">
              <span className="mono-text" title={record.internalVariantId}>
                {record.internalVariantId}
                {record.externalProductId ? (
                  <span className="muted-text"> → {record.externalProductId}</span>
                ) : record.status === 'failed' && record.errors && record.errors.length > 0 ? (
                  <span className="muted-text"> {record.errors[0].code}</span>
                ) : null}
              </span>
              <StatusBadge
                tone={recordTone(record.status)}
                compact
                withDot
                pulse={record.status === 'pending'}
              >
                {statusLabel(record.status)}
              </StatusBadge>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function ShopPublishTracker({
  connectionId,
  recordId,
  batchId,
}: ShopPublishTrackerProps): ReactElement {
  if (batchId) {
    return <BulkTracker batchId={batchId} />;
  }
  if (recordId) {
    return <SingleTracker connectionId={connectionId} recordId={recordId} />;
  }
  return <></>;
}
