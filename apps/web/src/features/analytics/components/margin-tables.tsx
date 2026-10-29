/**
 * Margin tables
 *
 * "Margin by channel" (with a Total row) and "Margin by product". A ratio
 * with no denominator is `null` and renders as an absent value: a product
 * none of whose revenue has a cost shows "No cost recorded" plus an "Add cost"
 * link instead of a margin of 0.
 *
 * @module features/analytics/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { EmptyValue } from '../../../shared/ui/empty-value';
import { formatAmount } from '../../../shared/format/format-amount';
import { ConnectionCell, useConnectionsQuery } from '../../connections';
import { ConnectionDot } from '../../orders';
import type {
  MarginChannel,
  MarginFigures,
  MarginProductRow,
} from '../api/margin-analytics.types';
import { formatRatio } from '../lib/margin-copy';

export function marginSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function RatioValue({ ratio, absentLabel }: { ratio: number | null; absentLabel: string }): ReactElement {
  return ratio === null ? <EmptyValue label={absentLabel} /> : <>{formatRatio(ratio)}</>;
}

function FigureCells({
  figures,
  currency,
}: {
  figures: MarginFigures;
  currency: string;
}): ReactElement {
  return (
    <>
      <td className="analytics-margin__num">{formatAmount(figures.netRevenue, currency)}</td>
      <td className="analytics-margin__num">{formatAmount(figures.costOfGoods, currency)}</td>
      <td className="analytics-margin__num">{formatAmount(figures.grossMargin, currency)}</td>
      <td className="analytics-margin__num">
        <RatioValue ratio={figures.marginPct} absentLabel="Margin % needs a line with a cost" />
      </td>
      <td className="analytics-margin__num data-table__cell--hide-below-768">
        <RatioValue ratio={figures.costCoveragePct} absentLabel="No net revenue in this range" />
      </td>
    </>
  );
}

const COLUMN_HEADERS = (
  <>
    <th className="analytics-margin__num">Net revenue</th>
    <th className="analytics-margin__num">Cost of goods</th>
    <th className="analytics-margin__num">Gross margin</th>
    <th className="analytics-margin__num">Margin %</th>
    <th className="analytics-margin__num data-table__cell--hide-below-768">Cost coverage</th>
  </>
);

interface MarginByChannelTableProps {
  channels: readonly MarginChannel[];
  headline: MarginFigures;
  currency: string;
}

export function MarginByChannelTable({
  channels,
  headline,
  currency,
}: MarginByChannelTableProps): ReactElement {
  const connectionsQuery = useConnectionsQuery();
  const connectionsById = new Map((connectionsQuery.data ?? []).map((c) => [c.id, c]));

  return (
    <div
      className="data-table__container"
      tabIndex={0}
      role="region"
      aria-label="Margin by channel (scrollable)"
    >
      <table className="data-table" data-testid="margin-by-channel-table">
        <caption className="sr-only">Margin by channel</caption>
        <thead>
          <tr>
            <th>Channel</th>
            {COLUMN_HEADERS}
          </tr>
        </thead>
        <tbody>
          {channels.map((channel) => {
            const connection = connectionsById.get(channel.sourceConnectionId);
            return (
              <tr
                key={channel.sourceConnectionId}
                data-testid={`margin-channel-row-${channel.sourceConnectionId}`}
              >
                <td>
                  <ConnectionCell
                    connectionId={channel.sourceConnectionId}
                    connection={connection ?? null}
                    loading={connectionsQuery.isLoading}
                    adornment={
                      <ConnectionDot
                        name={connection?.name ?? null}
                        platformType={connection?.platformType}
                      />
                    }
                  />
                </td>
                <FigureCells figures={channel} currency={currency} />
              </tr>
            );
          })}
          <tr className="analytics-margin__total-row" data-testid="margin-channel-total-row">
            <td>Total</td>
            <FigureCells figures={headline} currency={currency} />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

interface MarginByProductTableProps {
  items: readonly MarginProductRow[];
  currency: string;
}

export function MarginByProductTable({ items, currency }: MarginByProductTableProps): ReactElement {
  return (
    <div
      className="data-table__container"
      tabIndex={0}
      role="region"
      aria-label="Margin by product (scrollable)"
    >
      <table className="data-table" data-testid="margin-by-product-table">
        <caption className="sr-only">Top products by net revenue with margin</caption>
        <thead>
          <tr>
            <th>Product</th>
            {COLUMN_HEADERS}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const slug = marginSlug(item.sku ?? item.productId);
            const noCost = item.coveredNetRevenue === 0;
            return (
              <tr key={item.productId} data-testid={`margin-product-row-${slug}`}>
                <td>
                  <div>{item.name ?? 'Unknown product'}</div>
                  {item.sku ? (
                    <div className="mono-text analytics-margin__sku">{item.sku}</div>
                  ) : null}
                </td>
                {noCost ? (
                  <>
                    <td className="analytics-margin__num">
                      {formatAmount(item.netRevenue, currency)}
                    </td>
                    <td className="analytics-margin__gap-cell" colSpan={3}>
                      <span className="status-badge status-badge--warning status-badge--compact">
                        <span className="status-badge__dot" aria-hidden="true" />
                        <span>No cost recorded</span>
                      </span>{' '}
                      <Link
                        to={`/products/${encodeURIComponent(item.productId)}`}
                        data-testid={`margin-add-cost-link-${slug}`}
                      >
                        Add cost
                      </Link>
                    </td>
                    <td className="analytics-margin__num data-table__cell--hide-below-768">
                      <RatioValue
                        ratio={item.costCoveragePct}
                        absentLabel="No net revenue in this range"
                      />
                    </td>
                  </>
                ) : (
                  <FigureCells figures={item} currency={currency} />
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
