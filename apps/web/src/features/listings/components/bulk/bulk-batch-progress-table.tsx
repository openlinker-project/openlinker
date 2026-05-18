/**
 * Bulk batch progress table (#741)
 *
 * One row per `BulkBatchRecordSummary`. Variant ID as the identity column
 * (the BE summary doesn't carry product names today; mapping variant→product
 * for the row label is a follow-up tracked alongside the Smart-classification
 * surface — see plan §9 follow-up #6 candidate). Status pill + offer link /
 * failure excerpt + timestamp complete the row.
 *
 * The Smart classification badge is intentionally not rendered here — see
 * implementation-plan §2 (parent AC-7 deferral).
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import { useMemo, type ReactElement } from 'react';
import { DataTable, StatusBadge, TimeDisplay } from '../../../../shared/ui';
import type { DataTableColumn } from '../../../../shared/ui';
import type {
  BulkBatchRecordSummary,
} from '../../api/bulk-listings.types';
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
            // Truncated. Full error is on the offer-creation record detail (#465);
            // a hover-expand follow-up is filed as part of the per-record retry.
            return (
              <span className="bulk-batch__err" title="Open the listing for full error details">
                Failed — see record detail
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
    <DataTable<BulkBatchRecordSummary>
      caption="Bulk batch records"
      columns={columns}
      rows={records}
      rowKey={(record) => record.id}
    />
  );
}

function RecordStatusBadge({
  status,
}: {
  status: OfferCreationStatus;
}): ReactElement {
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
