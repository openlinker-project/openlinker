/**
 * Data Coverage Copy Helpers
 *
 * Pure derivations that turn a `CoverageCategoryRow` into the
 * `.attention-list__item` headline/sub/badge/action copy the Data Coverage
 * panel renders (#2474, Phase 7 — mockup:
 * docs/plans/mockups/analytics-display-currency-picker.html).
 *
 * Two hard regression guards this file exists to satisfy (mini-epic ACs):
 *  - Every string here is human-language — no raw backend enum value
 *    (`pre-rollout`, `awaiting_mapping`, `source_deleted`, …) is ever
 *    interpolated into a headline or sub.
 *  - Country-agnostic terminology throughout: "tax rate", never "VAT" — the
 *    mockup's own correction, re-applied here so it can't regress.
 *
 * Currency's live in-progress/failed/fixed sub-states are NOT derived here:
 * they depend on a polled `analytics_remediation_runs.status`, which this
 * pure function has no access to. The panel component layers those on top
 * of `deriveCoverageRowCopy`'s `'open'`-state defaults.
 *
 * @module apps/web/src/features/analytics/lib
 */
import type { StatusBadgeTone } from '../../../shared/ui';
import type { CoverageCategory, CoverageCategoryRow } from '../api/analytics-coverage.types';
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

function orderWord(count: number): string {
  return count === 1 ? 'order' : 'orders';
}

export function deriveCoverageRowCopy(row: CoverageCategoryRow): DataCoverageRowCopy {
  const n = row.affectedCount;
  const word = orderWord(n);

  switch (row.category) {
    case 'currency':
      return {
        headline: `${n} ${word} counted in an outdated currency`,
        sub: 'The reporting currency changed — these orders are still tagged with the old one.',
        tone: 'warning',
        badgeLabel: 'Action',
        actionLabel: 'Recalculate now',
        modalTitle: `${n} ${word} counted in an outdated currency`,
        modalDescription: 'These orders are still tagged with a currency that is no longer the reporting currency.',
      };
    case 'tax-a':
      return {
        headline: `${n} ${word} have an unconfirmed tax rate`,
        sub: 'The rate came from today’s product catalog, not the order date — that’s why they’re excluded from Net Sales.',
        tone: 'warning',
        badgeLabel: 'Action',
        actionLabel: 'Include anyway',
        modalTitle: `${n} ${word} have an unconfirmed tax rate`,
        modalDescription: 'The rate came from today’s product catalog — not confirmed for the order date.',
      };
    case 'tax-b':
      return {
        headline: `${n} ${word} have no tax rate at all`,
        sub: 'The product has no tax rate set at the source — fix it there, not here.',
        tone: 'info',
        badgeLabel: 'Info',
        actionLabel: 'View products',
        modalTitle: `${n} ${word} have no tax rate at all`,
        modalDescription: 'The product has no tax rate set at the source. This needs fixing there — it can’t be guessed here.',
      };
    case 'tax-c':
      return {
        headline: `${n} ${word} — rate not yet resolved`,
        sub: 'Product was added after per-line tax rates went live — the catalog hasn’t answered yet.',
        tone: 'neutral',
        badgeLabel: 'Info',
        actionLabel: 'View orders',
        modalTitle: `${n} ${word} — rate still unresolved`,
        modalDescription: 'These products were added after per-line tax rates went live — this is a current catalog-read gap, not an old issue.',
      };
    case 'product-matching':
      return {
        headline: `${n} ${word} with a product-matching error`,
        sub: 'The product was removed at the source, or matching failed.',
        tone: 'info',
        badgeLabel: 'Info',
        actionLabel: 'View orders',
        modalTitle: `${n} ${word} with a product-matching error`,
        modalDescription: 'The product was removed at the source, or matching failed — open the order to match it manually.',
      };
    default: {
      const exhaustive: never = row.category;
      throw new Error(`Unhandled coverage category: ${String(exhaustive)}`);
    }
  }
}

export const DATA_COVERAGE_CHECK_COUNT = 5;

/** Human-language label for a `product-matching` row's record status. Never rendered raw. */
export function describeMatchingRecordStatus(status: ProductMatchingRecordStatus): string {
  switch (status) {
    case 'awaiting_mapping':
      return 'Matching in progress';
    case 'source_deleted':
      return 'Removed at the source';
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
];
