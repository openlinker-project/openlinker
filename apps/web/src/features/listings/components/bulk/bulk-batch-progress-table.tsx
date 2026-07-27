/**
 * Bulk batch progress table (#741 / #806 / #1741)
 *
 * A per-product rollup (#1741) sits above the flat per-variant records table.
 * The rollup groups records by product and shows "n of m live" progress with a
 * bar; a group with a failed variant reads "n/m live · {variant} failed -
 * listing incomplete" so the operator sees which listing is partial.
 *
 * The flat table renders one row per `BulkBatchRecordSummary` (variant label
 * preferred over the raw variant id). Status pill + offer link / failure reason
 * + timestamp complete the row. Failed rows show the first error message inline
 * (truncated) and a "Details" button that opens the per-record failure dialog
 * (#806) - the structured errors ride along on the polled batch-summary payload,
 * so no extra fetch.
 *
 * The Smart classification badge is intentionally not rendered here - see
 * implementation-plan §2 (parent AC-7 deferral).
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import { useMemo, useState, type ReactElement } from 'react';
import { Button, DataTable, StatusBadge, TimeDisplay } from '../../../../shared/ui';
import type { DataTableColumn } from '../../../../shared/ui';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '../../../../shared/ui/dialog';
import type { BulkBatchRecordSummary } from '../../api/bulk-listings.types';
import type { OfferCreationStatus } from '../../api/listings.types';

interface BulkBatchProgressTableProps {
  records: BulkBatchRecordSummary[];
  /** Marketplace URL builder (e.g. for Allegro: allegro.pl/oferta/...). */
  buildExternalOfferUrl?: (externalOfferId: string) => string;
}

/** Statuses that count as a live offer for the per-product rollup (#1741). */
const LIVE_STATUSES: readonly OfferCreationStatus[] = ['active', 'draft', 'reused'];

/**
 * Above this many flat records, the per-variant DataTable virtualizes (#1741 AC
 * J). The DataTable primitive already wraps `@tanstack/react-virtual`; a bulk
 * batch rarely exceeds a few hundred records so a modest threshold keeps small
 * batches on the plain (fully-rendered, no fixed-height container) path.
 */
const VIRTUALIZE_THRESHOLD = 200;

export function BulkBatchProgressTable({
  records,
  buildExternalOfferUrl,
}: BulkBatchProgressTableProps): ReactElement {
  const [detailRecord, setDetailRecord] = useState<BulkBatchRecordSummary | null>(null);

  const groups = useMemo(() => groupByProduct(records), [records]);
  const hasFailedGroup = groups.some((g) => g.failedLabel !== null);

  const columns: DataTableColumn<BulkBatchRecordSummary>[] = useMemo(
    () => [
      {
        id: 'variant',
        header: 'Variant',
        cell: (record) =>
          record.variantLabel ? (
            <span title={record.internalVariantId}>{record.variantLabel}</span>
          ) : (
            <span className="mono-text" title={record.internalVariantId}>
              {record.internalVariantId}
            </span>
          ),
      },
      {
        id: 'status',
        header: 'Status',
        cell: (record) => <RecordStatusBadge status={record.status} />,
      },
      {
        id: 'offerOrError',
        header: 'Offer / failure',
        cell: (record) => {
          if (
            record.status === 'active' ||
            record.status === 'draft' ||
            record.status === 'reused'
          ) {
            if (!record.externalOfferId) {
              return <span className="dim">-</span>;
            }
            const url = buildExternalOfferUrl?.(record.externalOfferId);
            return url ? (
              <a className="bulk-batch__ext-link" href={url} target="_blank" rel="noreferrer">
                {record.externalOfferId} ↗
              </a>
            ) : (
              <span className="mono-text">{record.externalOfferId}</span>
            );
          }
          if (record.status === 'failed') {
            const firstMessage = record.errors?.[0]?.message;
            return (
              <span className="bulk-batch__err-cell">
                <span className="bulk-batch__err" title={firstMessage ?? 'Failed'}>
                  {firstMessage ?? 'Failed'}
                </span>
                <Button
                  tone="ghost"
                  className="button--xs"
                  aria-label={`Failure details for ${record.internalVariantId}`}
                  onClick={() => {
                    setDetailRecord(record);
                  }}
                >
                  Details
                </Button>
              </span>
            );
          }
          if (record.status === 'pending') {
            return <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Queued</span>;
          }
          if (record.status === 'validating') {
            return (
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                Validating on marketplace…
              </span>
            );
          }
          return <span className="dim">-</span>;
        },
      },
      {
        id: 'updatedAt',
        header: 'Updated',
        align: 'right',
        cell: (record) =>
          record.status === 'pending' ? (
            <span className="mono-text dim">-</span>
          ) : (
            <span className="mono-text">
              <TimeDisplay iso={record.updatedAt} format="datetime" />
            </span>
          ),
        hideBelow: 768,
      },
    ],
    [buildExternalOfferUrl],
  );

  return (
    <>
      {groups.length > 0 ? (
        <section className="bulk-progress" aria-label="Per-product progress">
          <ul className="bulk-progress__list">
            {groups.map((group) => (
              <ProductRollupRow key={group.key} group={group} />
            ))}
          </ul>
          {hasFailedGroup ? (
            <p className="dim" style={{ marginTop: 'var(--space-3)', fontSize: 12 }}>
              Retry re-runs the saved data; a data fix is a new batch excluding the
              already-live siblings.
            </p>
          ) : null}
        </section>
      ) : null}

      <DataTable<BulkBatchRecordSummary>
        caption="Bulk batch records"
        columns={columns}
        rows={records}
        rowKey={(record) => record.id}
        virtualize={records.length > VIRTUALIZE_THRESHOLD}
      />

      <Dialog
        open={detailRecord !== null}
        onOpenChange={(open) => {
          if (!open) setDetailRecord(null);
        }}
      >
        <DialogContent>
          {detailRecord ? (
            <RecordFailureDetail
              record={detailRecord}
              buildExternalOfferUrl={buildExternalOfferUrl}
            />
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button tone="secondary">Close</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface ProductGroup {
  key: string;
  name: string;
  live: number;
  total: number;
  /** Label of the first failed variant, or null when the group has no failure. */
  failedLabel: string | null;
}

function groupByProduct(records: BulkBatchRecordSummary[]): ProductGroup[] {
  const order: string[] = [];
  const byKey = new Map<string, BulkBatchRecordSummary[]>();

  for (const record of records) {
    const key = record.productId ?? record.internalVariantId;
    const bucket = byKey.get(key);
    if (bucket) {
      bucket.push(record);
    } else {
      byKey.set(key, [record]);
      order.push(key);
    }
  }

  return order.map((key) => {
    const bucket = byKey.get(key) ?? [];
    const live = bucket.filter((r) => LIVE_STATUSES.includes(r.status)).length;
    const firstFailed = bucket.find((r) => r.status === 'failed');
    const failedLabel = firstFailed
      ? firstFailed.variantLabel ?? firstFailed.internalVariantId
      : null;
    return {
      key,
      name: bucket[0]?.productName ?? 'Product',
      live,
      total: bucket.length,
      failedLabel,
    };
  });
}

function ProductRollupRow({ group }: { group: ProductGroup }): ReactElement {
  const { name, live, total, failedLabel } = group;
  const incomplete = failedLabel !== null;
  const complete = !incomplete && live === total;
  const pct = total > 0 ? Math.round((live / total) * 100) : 0;

  const rowClass = ['bulk-progress__row', incomplete ? 'bulk-progress__row--incomplete' : '']
    .filter(Boolean)
    .join(' ');
  const barClass = ['bulk-progress__bar', incomplete ? 'bulk-progress__bar--warn' : '']
    .filter(Boolean)
    .join(' ');

  const chipTone = incomplete ? 'warning' : complete ? 'success' : 'neutral';
  const chipLabel = incomplete ? 'incomplete' : complete ? 'complete' : 'in progress';

  const summary = incomplete
    ? `${live}/${total} live · ${failedLabel} failed - listing incomplete`
    : `${live} of ${total} live`;

  return (
    <li className={rowClass}>
      <div className={barClass}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="bulk-progress__name">
        {name}
        <small>{summary}</small>
      </div>
      <span className={`bulk-chip bulk-chip--${chipTone}`}>
        <span className="bulk-chip__dot" aria-hidden="true" />
        {chipLabel}
      </span>
    </li>
  );
}

function RecordFailureDetail({
  record,
  buildExternalOfferUrl,
}: {
  record: BulkBatchRecordSummary;
  buildExternalOfferUrl?: (externalOfferId: string) => string;
}): ReactElement {
  const offerUrl = record.externalOfferId
    ? buildExternalOfferUrl?.(record.externalOfferId)
    : undefined;
  return (
    <>
      <DialogTitle>Record failure detail</DialogTitle>
      <DialogDescription>
        Variant <span className="mono-text">{record.internalVariantId}</span>
      </DialogDescription>
      <dl className="bulk-batch__detail">
        <div className="bulk-batch__detail-row">
          <dt className="bulk-batch__detail-label">Status</dt>
          <dd>
            <RecordStatusBadge status={record.status} />
          </dd>
        </div>
        {record.externalOfferId ? (
          <div className="bulk-batch__detail-row">
            <dt className="bulk-batch__detail-label">Offer</dt>
            <dd>
              {offerUrl ? (
                <a
                  className="bulk-batch__ext-link"
                  href={offerUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {record.externalOfferId} ↗
                </a>
              ) : (
                <span className="mono-text">{record.externalOfferId}</span>
              )}
            </dd>
          </div>
        ) : null}
        <div className="bulk-batch__detail-row">
          <dt className="bulk-batch__detail-label">Updated</dt>
          <dd className="mono-text">
            <TimeDisplay iso={record.updatedAt} format="datetime" />
          </dd>
        </div>
        <div className="bulk-batch__detail-row bulk-batch__detail-row--errors">
          <dt className="bulk-batch__detail-label">Errors</dt>
          <dd>
            {record.errors && record.errors.length > 0 ? (
              <ul className="bulk-batch__err-list">
                {record.errors.map((err, i) => (
                  <li key={`${err.code}-${i}`} className="bulk-batch__err-item">
                    <span className="bulk-batch__err-code">{err.code}</span>
                    {err.field ? (
                      <span className="bulk-batch__err-field mono-text">{err.field}</span>
                    ) : null}
                    <span className="bulk-batch__err-msg">{err.message}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="dim">No structured error detail was recorded.</span>
            )}
          </dd>
        </div>
      </dl>
    </>
  );
}

function RecordStatusBadge({ status }: { status: OfferCreationStatus }): ReactElement {
  switch (status) {
    case 'pending':
      return <StatusBadge tone="neutral" withDot>pending</StatusBadge>;
    case 'validating':
      return <StatusBadge tone="info" withDot pulse>running</StatusBadge>;
    case 'draft':
      return <StatusBadge tone="success" withDot>draft</StatusBadge>;
    case 'active':
      return <StatusBadge tone="success" withDot>succeeded</StatusBadge>;
    case 'reused':
      return <StatusBadge tone="success" withDot>already existed</StatusBadge>;
    case 'failed':
      return <StatusBadge tone="error" withDot>failed</StatusBadge>;
  }
}
