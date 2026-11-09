/**
 * GiftPromotionsKpis (#3935)
 *
 * Four compact cards over the promotions list: how many are running, how many
 * wait (and why), and what the promotions gave and cost in the last 30 days.
 * The first two come from the list itself. The last two come from the gift
 * report, and while it is loading or failed they say so: an unknown figure is
 * never drawn as 0.
 *
 * @module apps/web/src/features/gifts/components
 */
import type { ReactElement } from 'react';
import { formatAmount } from '../../../shared/format/format-amount';
import { interpolate, useMessages } from '../../../shared/i18n';
import { KpiCard, KpiGrid } from '../../../shared/ui/kpi-card';
import type { GiftResults } from '../lib/gift-rule-stats';
import type { GiftRuleCounts } from '../lib/gift-rule-view';

export interface GiftPromotionsKpisProps {
  counts: GiftRuleCounts;
  /** `null` while the report is loading or when it failed. */
  results: GiftResults | null;
  reportFailed: boolean;
}

export function GiftPromotionsKpis({ counts, results, reportFailed }: GiftPromotionsKpisProps): ReactElement {
  const copy = useMessages('gifts').list;
  const paused = counts.pausedStock + counts.pausedLimit;
  const unknown = reportFailed ? copy.kpi.unknownHint : undefined;

  const costText =
    results === null
      ? '-'
      : results.costs.length === 0
        ? '0'
        : results.costs.map((c) => formatAmount(c.costNet, c.currency ?? '')).join(' + ');

  return (
    <div data-testid="gift-rule-kpis">
      <KpiGrid aria-label={copy.kpiLabel}>
        <KpiCard
          density="compact"
          label={copy.kpi.active}
          value={counts.active}
          tone="success"
          description={interpolate(copy.kpi.activeOf, { total: String(counts.total) })}
        />
        <KpiCard
          density="compact"
          label={copy.kpi.paused}
          value={paused}
          tone={paused > 0 ? 'warning' : 'neutral'}
          description={
            paused > 0
              ? interpolate(copy.kpi.pausedSplit, {
                  stock: String(counts.pausedStock),
                  limit: String(counts.pausedLimit),
                })
              : copy.kpi.pausedNone
          }
        />
        <KpiCard
          density="compact"
          label={copy.kpi.given}
          value={results === null ? '-' : results.units}
          valueSuffix={results === null ? undefined : copy.kpi.givenUnits}
          description={
            results === null ? unknown : interpolate(copy.kpi.givenOrders, { orders: String(results.orders) })
          }
        />
        <KpiCard
          density="compact"
          label={copy.kpi.cost}
          value={costText}
          description={
            results === null
              ? unknown
              : results.unknownCostUnits > 0
                ? interpolate(copy.kpi.costPartial, { n: String(results.unknownCostUnits) })
                : copy.kpi.costBasis
          }
        />
      </KpiGrid>
    </div>
  );
}
