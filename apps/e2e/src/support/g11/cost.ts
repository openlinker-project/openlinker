/**
 * Cost and margin API helpers for the G11 suite (#3591)
 *
 * Thin typed wrappers over the routes the scenarios touch, so a spec reads as
 * the scenario and not as URL assembly. They return raw responses where the
 * status is the assertion, and parsed bodies where the data is.
 *
 * @module support/g11
 */
import type { G11Http, G11Response } from './http';
import type { G11Db } from './db';
import { lit } from './db';

export interface VariantCostBody {
  variantId: string;
  netUnitCost: string | null;
  costCurrency: string | null;
  costUpdatedAt: string | null;
  costUpdatedByUserId: string | null;
}

export function setCost(
  http: G11Http,
  variantId: string,
  netUnitCost: string | null,
  currency: string | null,
): Promise<G11Response> {
  return http.patch(`/products/variants/${variantId}/cost`, { netUnitCost, currency });
}

export function clearCost(http: G11Http, variantId: string): Promise<G11Response> {
  return setCost(http, variantId, null, null);
}

export interface BulkFillBody {
  filled: string[];
  skippedAlreadySet: string[];
  notFound: string[];
}

export function bulkFill(
  http: G11Http,
  variantIds: string[],
  netUnitCost: string,
  currency: string,
): Promise<G11Response> {
  return http.patch('/products/variants/cost', { variantIds, netUnitCost, currency });
}

/** Set a cost and fail loudly if the API refused, so a scenario never runs on a silent no-op. */
export async function mustSetCost(
  http: G11Http,
  variantId: string,
  netUnitCost: string,
  currency = 'PLN',
): Promise<VariantCostBody> {
  const response = await setCost(http, variantId, netUnitCost, currency);
  if (response.status !== 200) {
    throw new Error(`setting cost on ${variantId} failed: HTTP ${response.status} ${response.text}`);
  }
  return response.json<VariantCostBody>();
}

export async function mustClearCost(http: G11Http, variantId: string): Promise<void> {
  const response = await clearCost(http, variantId);
  if (response.status !== 200) {
    throw new Error(`clearing cost on ${variantId} failed: HTTP ${response.status} ${response.text}`);
  }
}

/**
 * Move a variant's `costUpdatedAt` into the future. An order placed by a shop
 * "now" is then older than the cost, which is exactly the G11-G situation of an
 * old order imported after a cost exists - without back-dating anything in the
 * order tables. SQL by decision: no flow produces this.
 */
export function backdateCostTimestampPastNow(db: G11Db, variantId: string, hoursAhead = 24): void {
  db.exec(
    `UPDATE product_variants SET "costUpdatedAt" = now() + interval '${Math.trunc(hoursAhead)} hours'
       WHERE id = ${lit(variantId)} AND "netUnitCost" IS NOT NULL`,
  );
}

export interface MarginGap {
  reason: string;
  lineCount: number;
  netAmount: number;
}

export interface MarginFig {
  netRevenue: number;
  coveredNetRevenue: number;
  costOfGoods: number;
  grossMargin: number;
  marginPct: number | null;
  costCoveragePct: number | null;
  gaps: MarginGap[];
}

export interface MarginChannel extends MarginFig {
  sourceConnectionId: string;
}

export interface MarginTrendPoint extends MarginFig {
  date: string;
}

export interface MarginResponse {
  currency: string;
  bucket: string;
  headline: MarginFig;
  trend: MarginTrendPoint[];
  channels: MarginChannel[];
  excludedLineCount: number;
}

export interface MarginVariantRow extends MarginFig {
  variantId: string | null;
  sku: string | null;
  attributes: Record<string, string> | null;
}

export interface MarginProductRow extends MarginFig {
  productId: string;
  name: string | null;
  sku: string | null;
}

export async function getMargin(
  http: G11Http,
  range: { from: string; to: string },
  extra: Record<string, string | number | undefined> = {},
): Promise<MarginResponse> {
  const response = await http.get('/analytics/margin', { query: { ...range, ...extra } });
  if (response.status !== 200) throw new Error(`GET /analytics/margin -> ${response.status} ${response.text}`);
  return response.json<MarginResponse>();
}

export async function getMarginVariants(
  http: G11Http,
  productId: string,
  range: { from: string; to: string },
): Promise<MarginVariantRow[]> {
  const response = await http.get(`/analytics/margin/products/${productId}/variants`, { query: range });
  if (response.status !== 200) {
    throw new Error(`GET margin variants -> ${response.status} ${response.text}`);
  }
  return response.json<{ variants: MarginVariantRow[] }>().variants;
}

export function sumGaps(fig: MarginFig, reason?: string): { lineCount: number; netAmount: number } {
  return fig.gaps
    .filter((g) => reason === undefined || g.reason === reason)
    .reduce((acc, g) => ({ lineCount: acc.lineCount + g.lineCount, netAmount: acc.netAmount + g.netAmount }), {
      lineCount: 0,
      netAmount: 0,
    });
}

/** Difference of two margin figures, field by field. Money rounds to cents. */
export function figDelta(after: MarginFig | undefined, before: MarginFig | undefined): {
  netRevenue: number;
  coveredNetRevenue: number;
  costOfGoods: number;
  gaps: Record<string, { lineCount: number; netAmount: number }>;
} {
  const zero: MarginFig = { netRevenue: 0, coveredNetRevenue: 0, costOfGoods: 0, grossMargin: 0, marginPct: null, costCoveragePct: null, gaps: [] };
  const a = after ?? zero;
  const b = before ?? zero;
  const round = (n: number): number => Math.round(n * 100) / 100;
  const reasons = new Set([...a.gaps.map((g) => g.reason), ...b.gaps.map((g) => g.reason)]);
  const gaps: Record<string, { lineCount: number; netAmount: number }> = {};
  for (const reason of reasons) {
    const ga = sumGaps(a, reason);
    const gb = sumGaps(b, reason);
    gaps[reason] = { lineCount: ga.lineCount - gb.lineCount, netAmount: round(ga.netAmount - gb.netAmount) };
  }
  return {
    netRevenue: round(a.netRevenue - b.netRevenue),
    coveredNetRevenue: round(a.coveredNetRevenue - b.coveredNetRevenue),
    costOfGoods: round(a.costOfGoods - b.costOfGoods),
    gaps,
  };
}

/** The variant's margin row, or `undefined` when nothing of it was sold in range. */
export async function variantMargin(
  http: G11Http,
  productId: string,
  variantId: string,
  range: { from: string; to: string },
): Promise<MarginVariantRow | undefined> {
  return (await getMarginVariants(http, productId, range)).find((v) => v.variantId === variantId);
}
