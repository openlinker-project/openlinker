/**
 * Bulk batch progress table (#741 / #806)
 *
 * One row per `BulkBatchRecordSummary`. Variant ID as the identity column
 * (the BE summary doesn't carry product names today; mapping variant→product
 * for the row label is a follow-up tracked alongside the Smart-classification
 * surface — see plan §9 follow-up #6 candidate). Status pill + offer link /
 * failure reason + timestamp complete the row.
 *
 * Failed rows show the first error message inline (truncated) and a "Details"
 * button that opens the per-record failure dialog (#806) — the structured
 * errors ride along on the polled batch-summary payload, so no extra fetch.
 *
 * The Smart classification badge is intentionally not rendered here — see
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

export function BulkBatchProgressTable({
  records,
  buildExternalOfferUrl,
}: BulkBatchProgressTableProps): ReactElement {
  const [detailRecord, setDetailRecord] = useState<BulkBatchRecordSummary | null>(null);

  const columns: DataTableColumn<BulkBatchRecordSummary>[] = useMemo(
    () => [
      {
        id: 'variantId',
        header: 'Variant ID',
        cell: (record) => (
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
          if (record.status === 'active' || record.status === 'draft') {
            if (!record.externalOfferId) {
              return <span className="dim">—</span>;
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
          return <span className="dim">—</span>;
        },
      },
      {
        id: 'updatedAt',
        header: 'Updated',
        align: 'right',
        cell: (record) =>
          record.status === 'pending' ? (
            <span className="mono-text dim">—</span>
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
      <DataTable<BulkBatchRecordSummary>
        caption="Bulk batch records"
        columns={columns}
        rows={records}
        rowKey={(record) => record.id}
      />

      <Dialog
        open={detailRecord !== null}
        onOpenChange={(open) => {
          if (!open) setDetailRecord(null);
        }}
      >
        <DialogContent>
          {detailRecord ? <RecordFailureDetail record={detailRecord} /> : null}
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

function RecordFailureDetail({ record }: { record: BulkBatchRecordSummary }): ReactElement {
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
            <dd className="mono-text">{record.externalOfferId}</dd>
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
    case 'failed':
      return <StatusBadge tone="error" withDot>failed</StatusBadge>;
  }
}
