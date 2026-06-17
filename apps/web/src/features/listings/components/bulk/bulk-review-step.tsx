/**
 * Bulk wizard Step 3 — Review table (#792 PR 3)
 *
 * One row per selected product. Renders the per-row blocker chips, the
 * computed price/stock (master → policy → override) with a provenance badge
 * when the value isn't the raw master, the resolved category, and an Edit
 * button. "Approve all" stays disabled while any listable row still carries a
 * blocker; no-variant products are skipped, not blocking.
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
import type { DataTableColumn, StatusBadgeTone } from '../../../../shared/ui';
import type { OfferBlockerDescriptor } from '../../../../shared/plugins';
import type { BulkPerProductOverride } from '../../api/bulk-listings.types';
import {
  computeResolvedPrice,
  computeResolvedStock,
  type ResolvedPrice,
  type ResolvedStock,
} from './bulk-policy';
import type {
  BulkRowBlocker,
  BulkValueSource,
  BulkWizardRow,
  PricingPolicy,
  StockPolicy,
} from './bulk-wizard.types';
import { BulkEditModal } from './bulk-edit-modal';

interface BulkReviewStepProps {
  rows: BulkWizardRow[];
  connectionId: string;
  pricingPolicy: PricingPolicy;
  stockPolicy: StockPolicy;
  /** Batch-wide currency (D7). */
  currency: string;
  publishImmediately: boolean;
  /**
   * True while category parameter schemas are still loading (#810). Gates
   * "Approve all" so the operator can't submit before a platform-specific
   * blocker (e.g. Allegro's add-product-params) has had a chance to appear.
   */
  paramsResolving: boolean;
  /**
   * Platform-declared blocker chip descriptors (#1096) for the batch's
   * connection. Merged with the host-neutral chips so Review renders any
   * marketplace's blockers generically — no host enum of platform blockers.
   */
  platformBlockerChips: readonly OfferBlockerDescriptor[];
  onUpdateRow: (
    variantId: string,
    override: BulkPerProductOverride,
    editFormValues: Record<string, unknown>,
  ) => void;
  onApproveAll: () => void;
  onBack: () => void;
}

/** Host-neutral blocker chips — generic across every marketplace. */
const NEUTRAL_BLOCKER_CHIPS: Record<string, { tone: StatusBadgeTone; label: string }> = {
  'no-variant': { tone: 'neutral', label: 'no variant' },
  'no-ean': { tone: 'error', label: 'no EAN' },
  'no-match': { tone: 'error', label: 'manual category' },
  'multi-match': { tone: 'warning', label: 'choose category' },
  'no-master-price': { tone: 'error', label: 'no master price' },
  'no-master-stock': { tone: 'error', label: 'no master stock' },
  'currency-mismatch': { tone: 'warning', label: 'currency mismatch' },
};

const FALLBACK_CHIP = { tone: 'warning' as StatusBadgeTone, label: 'needs attention' };

export function BulkReviewStep({
  rows,
  connectionId,
  pricingPolicy,
  stockPolicy,
  currency,
  publishImmediately,
  paramsResolving,
  platformBlockerChips,
  onUpdateRow,
  onApproveAll,
  onBack,
}: BulkReviewStepProps): ReactElement {
  // Merge host-neutral chips with the platform-declared ones (#1096).
  const blockerChips = useMemo<Record<string, { tone: StatusBadgeTone; label: string }>>(() => {
    const merged: Record<string, { tone: StatusBadgeTone; label: string }> = {
      ...NEUTRAL_BLOCKER_CHIPS,
    };
    for (const chip of platformBlockerChips) {
      merged[chip.id] = { tone: chip.tone as StatusBadgeTone, label: chip.label };
    }
    return merged;
  }, [platformBlockerChips]);
  const [filter, setFilter] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  const filteredRows = useMemo(() => {
    if (filter.trim() === '') return rows;
    const needle = filter.toLowerCase();
    return rows.filter(
      (r) =>
        (r.product?.name ?? '').toLowerCase().includes(needle) ||
        (r.primaryVariant?.sku ?? '').toLowerCase().includes(needle),
    );
  }, [rows, filter]);

  const counts = useMemo(() => countByReadiness(rows), [rows]);
  // No-variant rows are skipped on submit, not blocking. Approval is gated on
  // every *listable* row being clear, with at least one ready row to submit —
  // and on platform schemas (e.g. Allegro category params) having settled, so a
  // row that's about to gain a platform blocker can't sneak through (#810/#1096).
  const canApprove = counts.ready > 0 && counts.needsAttention === 0 && !paramsResolving;

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
        cell: (row) => <RowStatusCell blockers={row.blockers} chips={blockerChips} />,
      },
      {
        id: 'category',
        header: 'Matched category',
        // Effective submit category — an operator pick (override) wins over the
        // EAN-resolved value, which stays put for the card-link guard (#810).
        cell: (row) => {
          const categoryId = row.override.overrides?.categoryId ?? row.resolvedCategoryId;
          return (
            <span
              className={
                categoryId
                  ? 'bulk-wizard__row-category'
                  : 'bulk-wizard__row-category bulk-wizard__row-category--dim'
              }
            >
              {categoryId ?? '—'}
            </span>
          );
        },
      },
      {
        id: 'stock',
        header: 'Stock',
        align: 'right',
        cell: (row) => {
          const stock = computeResolvedStock(stockPolicy, row.masterStock, row.override);
          return <ValueCell value={stock.value} source={stock.source} />;
        },
        hideBelow: 768,
      },
      {
        id: 'price',
        header: 'Price',
        align: 'right',
        cell: (row) => {
          if (row.blockers.includes('currency-mismatch')) {
            return <span className="bulk-wizard__row-category--dim">—</span>;
          }
          const price = computeResolvedPrice(pricingPolicy, row.masterPrice, row.override);
          return (
            <ValueCell
              value={price.value}
              source={price.source}
              format={(v) => `${v.toFixed(2)} ${currency}`}
            />
          );
        },
        hideBelow: 768,
      },
      {
        id: 'actions',
        header: '',
        align: 'right',
        cell: (row) =>
          row.primaryVariant === null ? (
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>No variant</span>
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
    [pricingPolicy, stockPolicy, currency, blockerChips],
  );

  const editingPrice: ResolvedPrice | null = editingRow
    ? computeResolvedPrice(pricingPolicy, editingRow.masterPrice, editingRow.override)
    : null;
  const editingStock: ResolvedStock | null = editingRow
    ? computeResolvedStock(stockPolicy, editingRow.masterStock, editingRow.override)
    : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <header style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-4)' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>
            Review {rows.length} {rows.length === 1 ? 'product' : 'products'}
          </h2>
          <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 13 }}>
            Click <strong>Edit</strong> to override any row before submit. Approve all stays
            disabled while rows need attention.
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
          <Button tone="primary" disabled={!canApprove} onClick={onApproveAll}>
            Approve all ({counts.ready})
          </Button>
        </div>
      </header>

      <div className="bulk-wizard__review-summary">
        <span><strong>{counts.ready}</strong> ready</span>
        {counts.needsAttention > 0 ? (
          <>
            <span className="sep">·</span>
            <span><strong>{counts.needsAttention}</strong> need attention</span>
          </>
        ) : null}
        {counts.skipped > 0 ? (
          <>
            <span className="sep">·</span>
            <span><strong>{counts.skipped}</strong> skipped (no variant)</span>
          </>
        ) : null}
      </div>

      {counts.needsAttention > 0 ? (
        <p className="bulk-wizard__review-hint" role="status">
          <strong>{counts.needsAttention}</strong>{' '}
          {counts.needsAttention === 1 ? 'row needs' : 'rows need'} attention. Each flagged row
          shows why; <strong>Edit</strong> it to resolve the blocker before submitting.
        </p>
      ) : null}

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

      {editingRow && editingRow.primaryVariant && editingPrice && editingStock ? (
        <BulkEditModal
          open={editingId !== null}
          onOpenChange={(open) => {
            if (!open) setEditingId(null);
          }}
          row={editingRow}
          connectionId={connectionId}
          defaults={{
            stock: editingStock.value ?? 0,
            publishImmediately,
            priceAmount: editingPrice.value !== null ? editingPrice.value.toFixed(2) : '',
            priceCurrency: currency,
          }}
          onSave={onUpdateRow}
        />
      ) : null}
    </div>
  );
}

function RowStatusCell({
  blockers,
  chips,
}: {
  blockers: readonly BulkRowBlocker[];
  chips: Record<string, { tone: StatusBadgeTone; label: string }>;
}): ReactElement {
  if (blockers.length === 0) {
    return <StatusBadge tone="success" withDot>ready</StatusBadge>;
  }
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 'var(--space-1)' }}>
      {blockers.map((b) => {
        const chip = chips[b] ?? FALLBACK_CHIP;
        return (
          <StatusBadge key={b} tone={chip.tone} withDot compact>
            {chip.label}
          </StatusBadge>
        );
      })}
    </span>
  );
}

function ValueCell({
  value,
  source,
  format,
}: {
  value: number | null;
  source: BulkValueSource;
  format?: (v: number) => string;
}): ReactElement {
  if (value === null) {
    return <span className="bulk-wizard__row-category--dim">—</span>;
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', justifyContent: 'flex-end' }}>
      <span className="tabular">{format ? format(value) : value}</span>
      {source === 'policy' ? (
        <StatusBadge tone="warning" compact>POLICY</StatusBadge>
      ) : source === 'override' ? (
        <StatusBadge tone="review" compact>OVERRIDE</StatusBadge>
      ) : null}
    </span>
  );
}

function countByReadiness(rows: BulkWizardRow[]): {
  ready: number;
  needsAttention: number;
  skipped: number;
} {
  let ready = 0;
  let needsAttention = 0;
  let skipped = 0;
  for (const r of rows) {
    if (r.primaryVariant === null) {
      skipped += 1;
    } else if (r.blockers.length === 0) {
      ready += 1;
    } else {
      needsAttention += 1;
    }
  }
  return { ready, needsAttention, skipped };
}
