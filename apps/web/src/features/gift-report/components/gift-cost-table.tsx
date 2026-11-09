/**
 * Gift cost table (#3943, mockup states `report/gift-cost`, `report/unknown-cost`)
 *
 * One row per promotion (or per manual add) and gift. The cost column states
 * only what is known: a gift with no purchase cost on file shows
 * "Cost unknown" and its units are NOT in the amount, so a missing cost never
 * reads as a free gift.
 *
 * @module features/gift-report/components
 */
import type { ReactElement } from 'react';
import { DataTable, type DataTableColumn } from '../../../shared/ui/data-table';
import { useFormat, useMessages, interpolate } from '../../../shared/i18n';
import type { GiftReportGroup } from '../api/gift-report.types';

interface GiftCostTableProps {
  groups: readonly GiftReportGroup[];
}

export function GiftCostTable({ groups }: GiftCostTableProps): ReactElement {
  const copy = useMessages('gift-report').table;
  const format = useFormat();

  function promotionLabel(group: GiftReportGroup): string {
    if (group.giftSource === 'operator') return copy.manualLabel;
    if (group.giftSource === 'bundle') return copy.bundleLabel;
    if (group.ruleRef !== null) return group.ruleName ?? copy.deletedRule;
    return copy.channelLabel;
  }

  const columns: DataTableColumn<GiftReportGroup>[] = [
    {
      id: 'promotion',
      header: copy.promotion,
      cell: (group) => (
        <span data-testid={`gift-report-row-promotion-${group.key}`}>{promotionLabel(group)}</span>
      ),
    },
    {
      id: 'gift',
      header: copy.gift,
      cell: (group) => (
        <span>
          {group.name ?? group.sku ?? group.productId}
          {group.sku !== null && group.name !== null ? (
            <span className="text-muted"> {group.sku}</span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'pieces',
      header: copy.pieces,
      align: 'right',
      cell: (group) => <span data-testid={`gift-report-units-${group.key}`}>{group.units}</span>,
    },
    { id: 'orders', header: copy.orders, align: 'right', cell: (group) => group.orders },
    {
      id: 'cost',
      header: copy.cost,
      align: 'right',
      cell: (group) => {
        const known = group.units - group.unknownCostUnits;
        return (
          <span data-testid={`gift-report-cost-${group.key}`}>
            {known > 0 ? format.money(group.costNet, group.currency ?? undefined) : null}
            {group.unknownCostUnits > 0 ? (
              <span
                className="text-muted"
                data-testid={`gift-report-cost-unknown-badge-${group.key}`}
              >
                {known > 0
                  ? ` (${interpolate(copy.withoutPieces, { n: group.unknownCostUnits })})`
                  : copy.costUnknown}
              </span>
            ) : null}
          </span>
        );
      },
    },
  ];

  return (
    <section aria-label={copy.title}>
      <h3 className="section-title">{copy.title}</h3>
      <DataTable
        columns={columns}
        rows={[...groups]}
        rowKey={(group) => group.key}
        tableTestId="gift-report-table"
        rowTestId={(group) => `gift-report-row-${group.key}`}
      />
    </section>
  );
}
