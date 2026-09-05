/**
 * Money basis (Net / Gross) — #2895
 *
 * A page-wide viewing preference: which basis every currency-denominated
 * figure on `/analytics` renders in. It is URL state, exactly like
 * `displayCurrency`/`rateBasis` (ADR-064) — see `?basis=` in
 * `analytics-page.tsx`.
 *
 * `net` is the pre-existing default, NOT `gross` (deliberate deviation from
 * the #2895 issue's own "default is Gross" assumption — see this module's
 * own doc comment on {@link DEFAULT_MONEY_BASIS} for why). Every figure this
 * toggle governs already had a VAT-exclusive ("net") counterpart shipped by
 * the net-sales tax-rate epic (#2245/#2469) BEFORE this toggle existed, and
 * the KPI strip / by-channel table / top-products table already rendered
 * those net figures as their primary numbers — `netRevenue` labelled "Net
 * sales", `netAverageOrderValue`/`netMedianOrderValue`, per-channel and
 * per-product `netRevenue`. The one hard, repeatedly-stated #2895
 * acceptance criterion is that the DEFAULT toggle position reproduces
 * today's page byte-for-byte — so the default has to be whichever position
 * matches what is already rendered, which is `net`, not `gross`.
 *
 * Selecting `gross` is what is genuinely new: every one of those figures
 * switches to its GROSS (VAT-inclusive) counterpart — `revenue` instead of
 * `netRevenue`, `averageOrderValue` instead of `netAverageOrderValue`, and
 * so on — using fields the backend already computes and already returns
 * today (this is pure FE wiring, no new aggregation).
 *
 * Figures this toggle NEVER touches, because they are not money: units
 * sold, order counts, average daily orders, cancellation rate, return rate.
 * `cancelledValue` also never changes with this toggle — no
 * VAT-exclusive/net counterpart of it is computed anywhere in the backend
 * (there is no `netCancelledValue` field on `SalesAnalyticsHeadline` /
 * `ChannelSalesAnalytics`), and inventing one is a new aggregation, not a
 * wiring change — out of scope here (see `docs/specs/metrics-analytics-dashboard.md`
 * § Cancellations Value for the documented gap).
 *
 * @module features/analytics/lib
 */

export const MoneyBasisValues = ['gross', 'net'] as const;
export type MoneyBasis = (typeof MoneyBasisValues)[number];

/**
 * See the module doc comment for why this is `net`, not `gross`.
 */
export const DEFAULT_MONEY_BASIS: MoneyBasis = 'net';

/** Coerces an arbitrary URL search-param value to a {@link MoneyBasis} — anything other than the literal `'gross'` resolves to the default, same "narrow allow-list, wide fallback" shape `rateBasis` parsing already uses in `analytics-page.tsx`. */
export function parseMoneyBasis(value: string | null): MoneyBasis {
  return value === 'gross' ? 'gross' : DEFAULT_MONEY_BASIS;
}

/** Shape shared by every headline/channel/total-row/product-row figure this toggle governs — a gross amount and its VAT-exclusive counterpart, always computed over the SAME population (see each field's own backend doc comment). */
export interface MoneyBasisAmount {
  revenue: number;
  netRevenue: number;
}

/** Picks `revenue` or `netRevenue` per the selected basis. Named for the field, not `pick`/`select`, so a call site reads as a fact about the DATA rather than a generic getter. */
export function revenueForBasis(amount: MoneyBasisAmount, basis: MoneyBasis): number {
  return basis === 'gross' ? amount.revenue : amount.netRevenue;
}

/** Shape shared by every headline/channel/total-row AOV figure — `null` on the gross side is a real, distinct state (`SalesAnalyticsHeadline.averageOrderValue`/`medianOrderValue` are nullable at the backend; some FE call sites narrow that away, so this stays permissive). */
export interface MoneyBasisOrderValue {
  averageOrderValue: number | null;
  netAverageOrderValue: number | null;
}

export function averageOrderValueForBasis(
  amount: MoneyBasisOrderValue,
  basis: MoneyBasis
): number | null {
  return basis === 'gross' ? amount.averageOrderValue : amount.netAverageOrderValue;
}

export interface MoneyBasisMedianValue {
  medianOrderValue: number | null;
  netMedianOrderValue: number | null;
}

export function medianOrderValueForBasis(
  amount: MoneyBasisMedianValue,
  basis: MoneyBasis
): number | null {
  return basis === 'gross' ? amount.medianOrderValue : amount.netMedianOrderValue;
}

/** The user-facing label for whichever figure is CURRENTLY primary under this basis — "GMV" under gross, "Net sales" under net. Matches the existing KPI-strip/by-channel-table/top-products-table copy verbatim so the label never disagrees with which field is actually rendered. */
export function revenueLabelForBasis(basis: MoneyBasis): string {
  return basis === 'gross' ? 'GMV' : 'Net sales';
}
