/**
 * Data Coverage Row Helpers
 *
 * Pure derivations that turn a `CoverageCategoryRow` into the
 * `.attention-list__item` headline/sub/badge/action copy the Data Coverage
 * panel renders (#2474, Phase 7 - mockup:
 * docs/plans/mockups/analytics-display-currency-picker.html).
 *
 * Two hard regression guards this file exists to satisfy (mini-epic ACs):
 *  - Every string here is human-language - no raw backend enum value
 *    (`pre-rollout`, `awaiting_mapping`, `source_deleted`, …) is ever
 *    interpolated into a headline or sub.
 *  - Country-agnostic terminology throughout: "tax rate", never "VAT".
 *
 * The words live in the `analytics.dataCoverage` namespace and are read when
 * a function is called, never at module load, so they follow the active
 * language (ADR-081).
 *
 * Currency's live in-progress/failed/fixed sub-states are NOT derived here:
 * they depend on a polled `analytics_remediation_runs.status`, which this
 * pure function has no access to. The panel component layers those on top
 * of `deriveCoverageRowCopy`'s `'open'`-state defaults.
 *
 * @module apps/web/src/features/analytics/lib
 */
import { formatPlural, getLocale, getMessages } from '../../../shared/i18n';
import type { StatusBadgeTone } from '../../../shared/ui';
import type {
  CoverageCategory,
  CoverageCategoryRow,
  CoverageCountUnit,
} from '../api/analytics-coverage.types';
import type { ProductMatchingRecordStatus } from '../api/analytics-matching-coverage.types';

export interface DataCoverageRowCopy {
  headline: string;
  sub: string;
  tone: StatusBadgeTone;
  badgeLabel: string;
  actionLabel: string;
  modalTitle: string;
  modalDescription: string;
}

type CategoryCopyKey = 'currency' | 'taxA' | 'taxB' | 'taxC' | 'productMatching' | 'noCost';

/** Rows the panel asks the operator to act on; every other row is informational. */
const ACTION_CATEGORIES: ReadonlySet<CoverageCategory> = new Set(['currency', 'tax-a']);

const CATEGORY_TONE: Record<CoverageCategory, StatusBadgeTone> = {
  currency: 'warning',
  'tax-a': 'warning',
  'tax-b': 'info',
  'tax-c': 'neutral',
  'product-matching': 'info',
  'no-cost': 'info',
};

function categoryCopyKey(category: CoverageCategory): CategoryCopyKey {
  switch (category) {
    case 'currency':
      return 'currency';
    case 'tax-a':
      return 'taxA';
    case 'tax-b':
      return 'taxB';
    case 'tax-c':
      return 'taxC';
    case 'product-matching':
      return 'productMatching';
    case 'no-cost':
      return 'noCost';
    default: {
      const exhaustive: never = category;
      throw new Error(`Unhandled coverage category: ${String(exhaustive)}`);
    }
  }
}

export function deriveCoverageRowCopy(row: CoverageCategoryRow): DataCoverageRowCopy {
  const copy = getMessages('analytics').dataCoverage;
  const locale = getLocale();
  const unit: CoverageCountUnit = row.countUnit ?? 'orders';
  const category = copy.categories[categoryCopyKey(row.category)];
  const headline = formatPlural(row.affectedCount, category.headline[unit], locale);
  const modalTitle =
    'modalTitle' in category
      ? formatPlural(row.affectedCount, category.modalTitle[unit], locale)
      : headline;

  return {
    headline,
    sub: category.sub,
    tone: CATEGORY_TONE[row.category],
    badgeLabel: ACTION_CATEGORIES.has(row.category) ? copy.badge.action : copy.badge.info,
    actionLabel: category.actionLabel,
    modalTitle,
    modalDescription: category.modalDescription,
  };
}

export const DATA_COVERAGE_CHECK_COUNT = 6;

/**
 * Whether the Data Coverage panel currently has something an operator needs
 * to act on - either an action row (currently `currency`, `tax-a`) with at
 * least one affected order, or a row whose remediation run itself ended
 * `'failed'`. An informational row (`tax-b`, `tax-c`, `product-matching`,
 * `no-cost`) is deliberately excluded - surfacing it as a page-level warning
 * would overstate what is actually wrong.
 */
export function hasCoverageAttention(categories: CoverageCategoryRow[]): boolean {
  return categories.some((row) => {
    if (row.status === 'failed') return true;
    return ACTION_CATEGORIES.has(row.category) && row.affectedCount > 0;
  });
}

/** Human-language label for a `product-matching` row's record status. Never rendered raw. */
export function describeMatchingRecordStatus(status: ProductMatchingRecordStatus): string {
  const copy = getMessages('analytics').dataCoverage.matchingRecordStatus;
  switch (status) {
    case 'awaiting_mapping':
      return copy.awaitingMapping;
    case 'source_deleted':
      return copy.sourceDeleted;
    default: {
      const exhaustive: never = status;
      return String(exhaustive);
    }
  }
}

export const COVERAGE_CATEGORY_ORDER: CoverageCategory[] = [
  'currency',
  'tax-a',
  'tax-b',
  'tax-c',
  'product-matching',
  'no-cost',
];
