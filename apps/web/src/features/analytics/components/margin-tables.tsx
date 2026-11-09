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
import { useFormat, useMessages } from '../../../shared/i18n';
import { ConnectionCell, useConnectionsQuery } from '../../connections';
import { ConnectionDot } from '../../orders';
import type {
  MarginChannel,
  MarginFigures,
  MarginProductRow,
} from '../api/margin-analytics.types';
import { formatRatio } from '../lib/margin.lib';

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
  const copy = useMessages('analytics').marginTables;
  const format = useFormat();
  return (
    <>
      <td className="analytics-margin__num">{format.money(figures.netRevenue, currency)}</td>
      <td className="analytics-margin__num">{format.money(figures.costOfGoods, currency)}</td>
      <td className="analytics-margin__num">{format.money(figures.grossMargin, currency)}</td>
      <td className="analytics-margin__num">
        <RatioValue ratio={figures.marginPct} absentLabel={copy.marginPctNeedsCost} />
      </td>
      <td className="analytics-margin__num data-table__cell--hide-below-768">
        <RatioValue ratio={figures.costCoveragePct} absentLabel={copy.noNetRevenue} />
      </td>
    </>
  );
}

function ColumnHeaders(): ReactElement {
  const columns = useMessages('analytics').marginTables.columns;
  return (
    <>
      <th className="analytics-margin__num">{columns.netRevenue}</th>
      <th className="analytics-margin__num">{columns.costOfGoods}</th>
      <th className="analytics-margin__num">{columns.grossMargin}</th>
      <th className="analytics-margin__num">{columns.marginPct}</th>
      <th className="analytics-margin__num data-table__cell--hide-below-768">
        {columns.costCoverage}
      </th>
    </>
  );
}

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
  const copy = useMessages('analytics').marginTables;
  const connectionsQuery = useConnectionsQuery();
  const connectionsById = new Map((connectionsQuery.data ?? []).map((c) => [c.id, c]));

  return (
    <div
      className="data-table__container"
      tabIndex={0}
      role="region"
      aria-label={copy.byChannelRegion}
    >
      <table className="data-table" data-testid="margin-by-channel-table">
        <caption className="sr-only">{copy.byChannelCaption}</caption>
        <thead>
          <tr>
            <th>{copy.columns.channel}</th>
            <ColumnHeaders />
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
            <td>{copy.total}</td>
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
  const copy = useMessages('analytics').marginTables;
  const format = useFormat();
  return (
    <div
      className="data-table__container"
      tabIndex={0}
      role="region"
      aria-label={copy.byProductRegion}
    >
      <table className="data-table" data-testid="margin-by-product-table">
        <caption className="sr-only">{copy.byProductCaption}</caption>
        <thead>
          <tr>
            <th>{copy.columns.product}</th>
            <ColumnHeaders />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const slug = marginSlug(item.sku ?? item.productId);
            const noCost = item.coveredNetRevenue === 0;
            return (
              <tr key={item.productId} data-testid={`margin-product-row-${slug}`}>
                <td>
                  <div>{item.name ?? copy.unknownProduct}</div>
                  {item.sku ? (
                    <div className="mono-text analytics-margin__sku">{item.sku}</div>
                  ) : null}
                </td>
                {noCost ? (
                  <>
                    <td className="analytics-margin__num">
                      {format.money(item.netRevenue, currency)}
                    </td>
                    <td className="analytics-margin__gap-cell" colSpan={3}>
                      <span className="status-badge status-badge--warning status-badge--compact">
                        <span className="status-badge__dot" aria-hidden="true" />
                        <span>{copy.noCostRecorded}</span>
                      </span>{' '}
                      <Link
                        to={`/products/${encodeURIComponent(item.productId)}`}
                        data-testid={`margin-add-cost-link-${slug}`}
                      >
                        {copy.addCost}
                      </Link>
                    </td>
                    <td className="analytics-margin__num data-table__cell--hide-below-768">
                      <RatioValue
                        ratio={item.costCoveragePct}
                        absentLabel={copy.noNetRevenue}
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
