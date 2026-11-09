/**
 * Bundle view of the gift report (#3943, mockup states `report/bundles`,
 * `report/bundles-no-cost`)
 *
 * Bundle sales (units, net revenue, margin) and the demand bundles put on their
 * components. The cost of a bundle is the sum of its components' purchase
 * costs; when any component has none, the margin is withheld and the row says
 * so instead of showing a margin built on a missing number.
 *
 * @module features/gift-report/components
 */
import type { ReactElement } from 'react';
import { Alert } from '../../../shared/ui/alert';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { DataTable, type DataTableColumn } from '../../../shared/ui/data-table';
import { ErrorState, LoadingState } from '../../../shared/ui/feedback-state';
import { useFormat, useMessages } from '../../../shared/i18n';
import { useGiftBundleReportQuery } from '../hooks/use-gift-report-query';
import type {
  GiftBundleDemandRow,
  GiftBundleRow,
  GiftReportFilters,
} from '../api/gift-report.types';

interface GiftBundleViewProps {
  filters: GiftReportFilters;
}

export function GiftBundleView({ filters }: GiftBundleViewProps): ReactElement {
  const copy = useMessages('gift-report').bundles;
  const errorCopy = useMessages('gift-report').error;
  const format = useFormat();
  const query = useGiftBundleReportQuery(filters);

  if (query.isPending) {
    return <LoadingState title={copy.salesTitle} message={copy.salesTitle} />;
  }
  if (query.isError) {
    return <ErrorState title={errorCopy} message={errorCopy} />;
  }
  const { bundles, demand } = query.data;
  if (bundles.length === 0) {
    return (
      <p className="text-muted" data-testid="gift-report-bundle-empty">
        {copy.empty}
      </p>
    );
  }

  const money = (amount: number | null, currency: string | null): string | null =>
    amount === null ? null : format.money(amount, currency ?? undefined);

  const bundleColumns: DataTableColumn<GiftBundleRow>[] = [
    {
      id: 'bundle',
      header: copy.bundle,
      cell: (row) => (
        <span>
          {row.name ?? row.sku ?? row.bundleVariantId}
          {row.hasGiftSlot ? <StatusBadge tone="info" compact>{copy.giftInComposition}</StatusBadge> : null}
          {row.componentCostMissing ? (
            <StatusBadge
              tone="warning"
              compact
              data-testid={`gift-report-bundle-nocost-${row.bundleVariantId}`}
            >
              {copy.componentCostMissing}
            </StatusBadge>
          ) : null}
        </span>
      ),
    },
    { id: 'sold', header: copy.sold, align: 'right', cell: (row) => row.unitsSold },
    {
      id: 'revenue',
      header: copy.revenue,
      align: 'right',
      cell: (row) => money(row.revenueNet, row.currency),
    },
    {
      id: 'margin',
      header: copy.margin,
      align: 'right',
      cell: (row) => money(row.marginNet, row.currency),
    },
  ];

  const demandColumns: DataTableColumn<GiftBundleDemandRow>[] = [
    {
      id: 'component',
      header: copy.component,
      cell: (row) => row.name ?? row.sku ?? row.variantId,
    },
    { id: 'inBundles', header: copy.inBundles, align: 'right', cell: (row) => row.inBundles },
    { id: 'alone', header: copy.alone, align: 'right', cell: (row) => row.alone },
    {
      id: 'available',
      header: copy.available,
      align: 'right',
      cell: (row) => (row.available === null ? copy.unknown : row.available),
    },
  ];

  return (
    <div className="gift-report-bundles">
      <Alert tone="info" data-testid="gift-report-bundle-note">
        {copy.note}
      </Alert>
      <h3 className="section-title">{copy.salesTitle}</h3>
      <DataTable
        columns={bundleColumns}
        rows={bundles}
        rowKey={(row) => `${row.bundleVariantId}|${row.currency ?? ''}`}
        tableTestId="gift-report-bundle-table"
      />
      <h3 className="section-title">{copy.demandTitle}</h3>
      <DataTable
        columns={demandColumns}
        rows={demand}
        rowKey={(row) => row.variantId}
        tableTestId="gift-report-demand-table"
      />
    </div>
  );
}
