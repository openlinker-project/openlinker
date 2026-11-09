/**
 * Analytics Coverage Alert Badge
 *
 * A page-title-adjacent warning, visible only while the Data Coverage
 * panel (rendered at the bottom of the page) has something actionable —
 * see `hasCoverageAttention`. Renders nothing otherwise, so a healthy
 * install shows no badge at all.
 *
 * The panel itself lives at the very bottom of the page (moved there so the
 * order-derived figures read first), so an operator scanning only the title
 * area needs a way back to it without scrolling past everything else — the
 * popover's CTA does exactly that.
 *
 * @module apps/web/src/features/analytics/components
 */
import type { ReactElement } from 'react';
import { useMessages } from '../../../shared/i18n';
import { Button, Popover, PopoverContent, PopoverTrigger, StatusBadge } from '../../../shared/ui';
import { hasCoverageAttention } from '../lib/data-coverage.lib';
import type { CoverageCategoryRow } from '../api/analytics-coverage.types';

export const ANALYTICS_DATA_COVERAGE_ANCHOR_ID = 'analytics-data-coverage';

interface AnalyticsCoverageAlertBadgeProps {
  categories: CoverageCategoryRow[] | undefined;
}

export function AnalyticsCoverageAlertBadge({
  categories,
}: AnalyticsCoverageAlertBadgeProps): ReactElement | null {
  const copy = useMessages('analytics').analyticsCoverageAlertBadge;
  if (!categories || !hasCoverageAttention(categories)) {
    return null;
  }

  function scrollToCoverage(): void {
    document
      .getElementById(ANALYTICS_DATA_COVERAGE_ANCHOR_ID)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="analytics-coverage-alert-badge__trigger">
          <StatusBadge tone="warning" withDot compact>
            {copy.badge}
          </StatusBadge>
        </button>
      </PopoverTrigger>
      <PopoverContent className="analytics-coverage-alert-badge__content">
        <p>{copy.body}</p>
        <Button type="button" tone="secondary" onClick={scrollToCoverage}>
          {copy.goTo}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
