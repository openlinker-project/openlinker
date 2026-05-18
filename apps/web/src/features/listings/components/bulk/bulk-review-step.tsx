/**
 * Bulk wizard Step 3 — Review table
 *
 * One row per selected product. Renders the per-row status pill, the
 * resolved category, and an Edit button that opens the per-row modal.
 * The "Approve all" CTA stays disabled while any row is not in a ready
 * state (matched or pending-after-timeout — both flip to matched once
 * late-arriving resolves settle).
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import { useMemo, useState, type ReactElement } from 'react';
import {
  Button,
  DataTable,
  Input,
  ProductThumbnail,
  StatusBadge,
} from '../../../../shared/ui';
import type { DataTableColumn } from '../../../../shared/ui';
import type { BulkPerProductOverride } from '../../api/bulk-listings.types';
import type { BulkRowStatus, BulkWizardRow } from './bulk-wizard.types';
import { BulkEditModal } from './bulk-edit-modal';

interface BulkReviewStepProps {
  rows: BulkWizardRow[];
  connectionId: string;
  defaults: {
    stock: number;
    publishImmediately: boolean;
    priceAmount: string;
    priceCurrency: string;
  };
  onUpdateRow: (
    variantId: string,
    override: BulkPerProductOverride,
    editFormValues: Record<string, unknown>,
  ) => void;
  onApproveAll: () => void;
  onBack: () => void;
}

export function BulkReviewStep({
  rows,
  connectionId,
  defaults,
  onUpdateRow,
  onApproveAll,
  onBack,
}: BulkReviewStepProps): ReactElement {
  const [filter, setFilter] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  const filteredRows = useMemo(() => {
    if (filter.trim() === '') return rows;
    const needle = filter.toLowerCase();
    return rows.filter((r) =>
      (r.product?.name ?? '').toLowerCase().includes(needle) ||
      (r.primaryVariant?.sku ?? '').toLowerCase().includes(needle),
    );
  }, [rows, filter]);

  const counts = useMemo(() => countByReadiness(rows), [rows]);
  const canApprove = counts.notReady === 0 && rows.length > 0;

  const editingRow = useMemo(
    () => (editingId ? rows.find((r) => r.productId === editingId) ?? null : null),
    [editingId, rows],
  );

  const columns: DataTableColumn<BulkWizardRow>[] = useMemo(
    () => [
      {
        id: 'name',
        header: 'Product',
        cell: (row) => (
          <span className="bulk-wizard__row-name">
            <ProductThumbnail src={row.product?.images?.[0]} name={row.product?.name ?? ''} />
            <span className="bulk-wizard__row-name-text">
              {row.product?.name ?? <em>Loading…</em>}
            </span>
          </span>
        ),
        accessor: (row) => row.product?.name ?? '',
        sortable: true,
      },
      {
        id: 'status',
        header: 'Status',
        cell: (row) => <RowStatusBadge status={row.status} />,
      },
      {
        id: 'category',
        header: 'Matched category',
        cell: (row) => (
          <span
            className={
              row.resolvedCategoryId
                ? 'bulk-wizard__row-category'
                : 'bulk-wizard__row-category bulk-wizard__row-category--dim'
            }
          >
            {row.resolvedCategoryId ?? '—'}
          </span>
        ),
      },
      {
        id: 'stock',
        header: 'Stock',
        align: 'right',
        cell: (row) => (
          <span className="tabular">{row.override.stock ?? defaults.stock}</span>
        ),
        hideBelow: 768,
      },
      {
        id: 'price',
        header: 'Price',
        align: 'right',
        cell: (row) => (
          <span className="tabular">
            {row.override.price !== undefined
              ? `${row.override.price.amount.toFixed(2)} ${row.override.price.currency}`
              : `${defaults.priceAmount} ${defaults.priceCurrency}`}
          </span>
        ),
        hideBelow: 768,
      },
      {
        id: 'actions',
        header: '',
        align: 'right',
        cell: (row) =>
          row.status === 'no-variant' ? (
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              No variant
            </span>
          ) : (
            <Button
              tone="ghost"
              className="button--xs"
              onClick={() => { setEditingId(row.productId); }}
            >
              Edit
            </Button>
          ),
      },
    ],
    [defaults],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <header style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-4)' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>
            Review {rows.length} {rows.length === 1 ? 'product' : 'products'}
          </h2>
          <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 13 }}>
            Click <strong>Edit</strong> to override any row before submit. Approve all
            stays disabled while rows need attention.
          </p>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <Input
            type="search"
            placeholder="Filter…"
            value={filter}
            onChange={(e) => { setFilter(e.target.value); }}
            style={{ minWidth: 220 }}
            aria-label="Filter rows by product name or SKU"
          />
          <Button
            tone="primary"
            disabled={!canApprove}
            onClick={onApproveAll}
          >
            Approve all ({rows.length})
          </Button>
        </div>
      </header>

      <div className="bulk-wizard__review-summary">
        <span><strong>{counts.ready}</strong> ready</span>
        {counts.pending > 0 ? (
          <>
            <span className="sep">·</span>
            <span>
              <strong>{counts.pending}</strong>{' '}
              {counts.pending === 1 ? 'still resolving' : 'still resolving'}
            </span>
          </>
        ) : null}
        {counts.notReady > 0 ? (
          <>
            <span className="sep">·</span>
            <span>
              <strong>{counts.notReady}</strong> need manual category
            </span>
          </>
        ) : null}
      </div>

      <DataTable<BulkWizardRow>
        caption="Bulk listing review"
        columns={columns}
        rows={filteredRows}
        rowKey={(row) => row.productId}
      />

      <footer className="bulk-wizard__footer">
        <Button tone="ghost" onClick={onBack}>← Back</Button>
        <div className="bulk-wizard__footer-spacer" />
      </footer>

      {editingRow && editingRow.primaryVariant ? (
        <BulkEditModal
          open={editingId !== null}
          onOpenChange={(open) => {
            if (!open) setEditingId(null);
          }}
          row={editingRow}
          connectionId={connectionId}
          defaults={defaults}
          onSave={onUpdateRow}
        />
      ) : null}
    </div>
  );
}

function RowStatusBadge({ status }: { status: BulkRowStatus }): ReactElement {
  switch (status) {
    case 'matched':
      return <StatusBadge tone="success" withDot>matched</StatusBadge>;
    case 'resolving':
    case 'pending-after-timeout':
      return (
        <StatusBadge tone="info" withDot pulse>
          {status === 'resolving' ? 'resolving' : 'still resolving'}
        </StatusBadge>
      );
    case 'no-ean':
      return <StatusBadge tone="error" withDot>no EAN</StatusBadge>;
    case 'no-variant':
      return <StatusBadge tone="error" withDot>no variant</StatusBadge>;
    case 'no-match':
      return <StatusBadge tone="error" withDot>manual category required</StatusBadge>;
  }
}

function countByReadiness(rows: BulkWizardRow[]): {
  ready: number;
  pending: number;
  notReady: number;
} {
  let ready = 0;
  let pending = 0;
  let notReady = 0;
  for (const r of rows) {
    if (r.status === 'matched') {
      // A matched-from-resolve row can become "not ready" if the operator
      // explicitly cleared the override's categoryId; but ready by default.
      // If a row needed manual but the operator filled it via the edit modal,
      // we'd surface that here too. For v1 we trust the wizard's
      // applyOverrides mutation to update row.status on save (see wizard).
      ready += 1;
    } else if (r.status === 'pending-after-timeout' || r.status === 'resolving') {
      pending += 1;
    } else {
      notReady += 1;
    }
  }
  return { ready, pending, notReady };
}
