/**
 * Variant × channel sales matrix (#2765)
 *
 * The real thing the "consistency" + "computed, nicely summarized" feedback
 * asked for: one row per variant, one column per channel, real net sales +
 * units in every cell — reconciling exactly to the product row's own Net
 * sales/Units and to the outer table's own per-channel columns, because the
 * Total row/column here and the product-level figures both come from the
 * SAME underlying line-item sums, just grouped one level apart.
 *
 * Renders the SAME shape whether the product has one variant or several — a
 * simple product's sole (deterministic-synthetic) variant is a one-row
 * matrix, no Total row (nothing to sum against a single row); a genuinely
 * multi-variant product gets the identical table with more rows plus a
 * reconciling Total. Mounted only when its row is actually expanded — see
 * `use-top-product-variant-sales-query.ts` for why this fetches lazily
 * rather than being embedded in the top-products list response.
 *
 * A hand-rolled `<table>` (reusing the exact `.data-table`/
 * `.data-table__container` classes `DataTable` itself renders), not the
 * `DataTable` component — this table needs a real `<tfoot>` total row
 * sharing the body's own column widths, which `DataTable` has no primitive
 * for (its "footer" is a viewport-fixed action rail, an unrelated concept).
 * No sorting/pagination/virtualization is needed for a handful of variants,
 * so nothing is lost by not routing through it.
 *
 * @module features/analytics/components
 */
import type { ReactElement } from 'react';
import { EmptyValue } from '../../../shared/ui/empty-value';
import { ErrorState, LoadingState } from '../../../shared/ui/feedback-state';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { formatAmount } from '../../../shared/format/format-amount';
import { useNumberFormat } from '../../../shared/i18n/use-number-format';
import { deriveStockStatus, STOCK_STATUS_BADGE_TONE, STOCK_STATUS_LABEL } from '../../products';
import type { Connection } from '../../connections';
import { useTopProductVariantSalesQuery } from '../hooks/use-top-product-variant-sales-query';
import { ChannelPublishAction } from './channel-publish-action';
import { variantChannelCellFor } from '../lib/top-products-view-model';
import type { SalesAnalyticsFilters } from '../api/sales-analytics.types';
import type { TopProductVariantRow } from '../api/top-products.types';

interface VariantChannelMatrixProps {
  productId: string;
  productName: string;
  filters: SalesAnalyticsFilters;
  channelColumns: string[];
  connectionsById: Map<string, Connection>;
  /**
   * Channels this product is genuinely not listed on — already gated on the
   * list's `coverageGapAvailable` by the caller, so an empty array here
   * always means "nothing to claim" and never "the check failed"
   * (#2765 review, finding 7).
   */
  notListedConnectionIds: string[];
  demoMode: boolean;
}

/**
 * The identity line for one matrix row.
 *
 * Three cases, deliberately distinct (#2765 review, finding 3):
 *
 * - `variantId === null` — the real "Unassigned" bucket: line items that
 *   never resolved to a variant. This is the ONLY row that may say so.
 * - a non-null id the catalog could not resolve — a variant that sold but no
 *   longer exists in the catalog (the documented delete-then-recreate case
 *   leaves stale mappings behind). Labelling it "Unassigned" made a real
 *   variant indistinguishable from the unattributed bucket, so it says
 *   "Unresolved variant" and shows the raw id instead.
 * - anything else — attributes, else its SKU.
 */
function VariantIdentityCell({ variant }: { variant: TopProductVariantRow }): ReactElement {
  const attributeLine = variant.attributes
    ? Object.entries(variant.attributes)
        .map(([key, value]) => `${key}: ${String(value)}`)
        .join(', ')
    : null;
  const primary =
    attributeLine ??
    variant.sku ??
    (variant.variantId === null ? 'Unassigned' : 'Unresolved variant');
  // The meta line only earns its place when it says something the identity
  // line hasn't already said — a simple variant with no attributes shows its
  // SKU once, not twice. An unresolved variant shows the raw id, which is
  // the only thing an operator can use to chase it.
  const meta = attributeLine
    ? variant.sku
    : primary === 'Unresolved variant'
      ? variant.variantId
      : null;
  const stockStatus = variant.totalAvailable !== null ? deriveStockStatus(variant.totalAvailable) : null;

  return (
    <div className="products-variant-row__id">
      <span className="products-variant-row__attrs">{primary}</span>
      {meta ? <span className="products-variant-row__meta mono-text">{meta}</span> : null}
      {stockStatus ? (
        <StatusBadge compact withDot tone={STOCK_STATUS_BADGE_TONE[stockStatus]}>
          {STOCK_STATUS_LABEL[stockStatus]}
        </StatusBadge>
      ) : null}
    </div>
  );
}

function MoneyUnitsStack({
  netRevenue,
  currency,
  units,
  intFormat,
}: {
  netRevenue: number;
  currency: string | null;
  units: number;
  intFormat: Intl.NumberFormat;
}): ReactElement {
  return (
    <div className="data-table__stack">
      <span className="tabular">
        {currency ? formatAmount(netRevenue, currency) : <EmptyValue label="No Net sales figure in range" />}
      </span>
      <span className="variant-matrix__units tabular">{intFormat.format(units)}</span>
    </div>
  );
}

export function VariantChannelMatrix({
  productId,
  productName,
  filters,
  channelColumns,
  connectionsById,
  notListedConnectionIds,
  demoMode,
}: VariantChannelMatrixProps): ReactElement {
  const intFormat = useNumberFormat();
  const query = useTopProductVariantSalesQuery(productId, filters, { enabled: true });

  if (query.isLoading) {
    return (
      <LoadingState
        liveRegion="off"
        title="Loading variant sales"
        message="Fetching net sales and units per variant, per channel…"
      />
    );
  }

  if (query.error || !query.data) {
    return (
      <ErrorState
        title="Unable to load variant sales"
        message={query.error?.message ?? 'No data returned'}
      />
    );
  }

  const variants = query.data.variants;

  if (variants.length === 0) {
    return <EmptyValue label="No variant sales in this range" />;
  }

  const showTotalRow = variants.length > 1;

  const notListed = new Set(notListedConnectionIds);
  const channelHeadings = channelColumns.map((connectionId) => ({
    connectionId,
    name: connectionsById.get(connectionId)?.name ?? connectionId,
    platformType: connectionsById.get(connectionId)?.platformType,
    isNotListed: notListed.has(connectionId),
  }));

  const channelTotals = channelHeadings.map(({ connectionId }) => {
    const revenue = variants.reduce(
      (sum, variant) => sum + (variantChannelCellFor(variant, connectionId)?.netRevenue ?? 0),
      0
    );
    const units = variants.reduce(
      (sum, variant) => sum + (variantChannelCellFor(variant, connectionId)?.units ?? 0),
      0
    );
    const currency =
      variants
        .map((variant) => variantChannelCellFor(variant, connectionId)?.currency ?? null)
        .find((value) => value !== null) ?? null;
    return { connectionId, revenue, units, currency };
  });
  const grandCurrency = variants.find((variant) => variant.currency)?.currency ?? null;
  const grandRevenue = variants.reduce((sum, variant) => sum + variant.netRevenue, 0);
  const grandUnits = variants.reduce((sum, variant) => sum + variant.units, 0);

  return (
    <div className="products-detail-variants">
      <div className="products-detail-field__label">Net sales by variant, per channel</div>
      <div className="data-table__container">
        <table className="data-table variant-matrix">
          <caption className="sr-only">Net sales and units per variant, per channel</caption>
          <thead>
            <tr>
              <th>Variant</th>
              {channelHeadings.map(({ connectionId, name, platformType, isNotListed }) => (
                <th key={connectionId} className="data-table__cell--right">
                  <span className="variant-matrix__channel-head">
                    <span className="trust-header__dot" data-channel={platformType} />
                    {name}
                  </span>
                  {/* Stated ONCE per column, never per cell: "this product
                      is not listed on this channel" is a fact about the
                      product and the channel, not about a variant, so
                      repeating it on every row would say N times something
                      true once. This is also the only place the mobile card
                      view can surface it and its remediation at all, since
                      cards have no channel columns (#2765 review,
                      findings 6 + 7). */}
                  {isNotListed ? (
                    <span className="cell-not-listed">
                      <span className="cell-not-listed__label">Not listed</span>
                      <ChannelPublishAction
                        productId={productId}
                        productName={productName}
                        connectionId={connectionId}
                        demoMode={demoMode}
                      />
                    </span>
                  ) : null}
                </th>
              ))}
              <th className="data-table__cell--right">Total</th>
            </tr>
          </thead>
          <tbody>
            {variants.map((variant) => (
              <tr key={variant.variantId ?? '__unassigned__'}>
                <td>
                  <VariantIdentityCell variant={variant} />
                </td>
                {channelHeadings.map(({ connectionId, isNotListed }) => {
                  const channel = variantChannelCellFor(variant, connectionId);
                  return (
                    <td key={connectionId} className="data-table__cell--right">
                      {isNotListed ? (
                        // Not "no figure in range" — there is no listing to
                        // have sold anything, which the column header
                        // already states. A `0` here would read as a real
                        // zero-unit channel.
                        <EmptyValue label="Not listed on this channel" />
                      ) : (
                        <MoneyUnitsStack
                          netRevenue={channel?.netRevenue ?? 0}
                          currency={channel?.currency ?? null}
                          units={channel?.units ?? 0}
                          intFormat={intFormat}
                        />
                      )}
                    </td>
                  );
                })}
                <td className="data-table__cell--right variant-matrix__total-cell">
                  <MoneyUnitsStack
                    netRevenue={variant.netRevenue}
                    currency={variant.currency}
                    units={variant.units}
                    intFormat={intFormat}
                  />
                </td>
              </tr>
            ))}
            {showTotalRow ? (
              <tr className="variant-matrix__total-row">
                <td>Total</td>
                {channelTotals.map(({ connectionId, revenue, units, currency }) => (
                  <td key={connectionId} className="data-table__cell--right">
                    {notListed.has(connectionId) ? (
                      <EmptyValue label="Not listed on this channel" />
                    ) : (
                      <MoneyUnitsStack
                        netRevenue={revenue}
                        currency={currency}
                        units={units}
                        intFormat={intFormat}
                      />
                    )}
                  </td>
                ))}
                <td className="data-table__cell--right variant-matrix__total-cell">
                  <MoneyUnitsStack
                    netRevenue={grandRevenue}
                    currency={grandCurrency}
                    units={grandUnits}
                    intFormat={intFormat}
                  />
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="data-table__footnote">
        {showTotalRow
          ? 'Adds up to the Net sales, Units and channel figures shown above.'
          : 'Matches the Net sales, Units and channel figures shown above — one variant, so nothing to sum.'}
      </p>
    </div>
  );
}
