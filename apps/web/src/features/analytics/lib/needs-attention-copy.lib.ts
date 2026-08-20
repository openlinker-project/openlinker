/**
 * Needs Attention Copy Helpers
 *
 * Pure derivations that turn a `NeedsAttentionSummary` category into the
 * one-line headline + qualifier the mockup's `.attention-list__item` shape
 * expects (docs/plans/implementation-plan-analytics-needs-attention.md,
 * Decisions 1-3). Isolated from the component so the wording can be revised
 * without touching render logic or its tests.
 *
 * Connection-naming rule (Decision 1): when every item in a category shares
 * a single connection (and, for stock, the same buffer), name it explicitly.
 * Otherwise fall back to a connection-agnostic headline — the per-item
 * detail lives behind the row's deep link, not in this summary line.
 *
 * Currency rule (Decision 2, corrected by the #1989 pre-implement gate):
 * `FailedSyncValueSummary` carries no currency field in either the mixed or
 * non-mixed case, so `totalValue` is always rendered currency-neutral here.
 * This is a documented interim pending #2049's reporting-currency stamping.
 *
 * @module apps/web/src/features/analytics/lib
 */
import type {
  CoverageGapItem,
  FailedSyncValueSummary,
  StockAtRiskItem,
} from '../api/needs-attention.types';

export interface AttentionRowCopy {
  headline: string;
  sub: string;
}

type ConnectionNameResolver = (connectionId: string) => string;

function uniqueValues<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

export function deriveCoverageHeadline(
  items: CoverageGapItem[],
  totalCount: number,
  connectionName: ConnectionNameResolver
): AttentionRowCopy {
  const variantWord = totalCount === 1 ? 'variant' : 'variants';
  const singleMissingConnectionIds = uniqueValues(
    items
      .filter((item) => item.missingFromConnectionIds.length === 1)
      .map((item) => item.missingFromConnectionIds[0])
  );

  const sharesOneMissingConnection =
    items.length > 0 &&
    items.every((item) => item.missingFromConnectionIds.length === 1) &&
    singleMissingConnectionIds.length === 1;

  if (sharesOneMissingConnection) {
    return {
      headline: `${totalCount} ${variantWord} missing from ${connectionName(singleMissingConnectionIds[0])}`,
      sub: 'listed elsewhere, not yet published on this channel',
    };
  }

  return {
    headline: `${totalCount} ${variantWord} have a listing gap on at least one channel`,
    sub: 'open the listing flow to see which channel is missing each one',
  };
}

export function deriveStockHeadline(
  items: StockAtRiskItem[],
  totalCount: number,
  connectionName: ConnectionNameResolver
): AttentionRowCopy {
  const variantWord = totalCount === 1 ? 'variant' : 'variants';
  const connectionIds = uniqueValues(items.map((item) => item.connectionId));
  const buffers = uniqueValues(items.map((item) => item.stockSafetyBuffer));

  const sharesOneConnectionAndBuffer =
    items.length > 0 && connectionIds.length === 1 && buffers.length === 1;

  if (sharesOneConnectionAndBuffer) {
    return {
      headline: `${totalCount} ${variantWord} at or below the safety buffer on ${connectionName(connectionIds[0])}`,
      sub: `buffer ${buffers[0]} — published stock is master stock minus the buffer`,
    };
  }

  return {
    headline: `${totalCount} ${variantWord} are at or below their channel's safety buffer`,
    sub: 'buffers vary by channel — open each variant to see the arithmetic',
  };
}

function formatCurrencyNeutral(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function deriveFailedSyncHeadline(summary: FailedSyncValueSummary): AttentionRowCopy {
  const orderWord = summary.count === 1 ? 'order' : 'orders';

  if (summary.mixedCurrency) {
    return {
      headline: `${summary.count} ${orderWord} across multiple currencies never reached a destination`,
      sub: 'currency-naive — a single total would misrepresent this sum',
    };
  }

  return {
    headline: `${formatCurrencyNeutral(summary.totalValue)} of orders never reached a destination`,
    sub: `${summary.count} ${orderWord} affected`,
  };
}
