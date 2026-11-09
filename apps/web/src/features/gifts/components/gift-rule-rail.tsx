/**
 * GiftRuleRail (#3935, mockup `gifts-rule-detail` right column)
 *
 * What helps while editing, beside the form: the promotion in one sentence, what
 * it gave in the last 30 days (saved promotions only), and one card with the dry
 * run on an order and the promotion's recent runs. A promotion that is not saved
 * has no results and no runs, so those parts are not drawn for it rather than
 * drawn empty.
 *
 * @module apps/web/src/features/gifts/components
 */
import { useMemo, useState, type ReactElement } from 'react';
import { formatAmount } from '../../../shared/format/format-amount';
import { formatAbsoluteDate as formatDate } from '../../../shared/format/format-date';
import { interpolate, useMessages } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { DetailSection } from '../../../shared/ui/detail-section';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../shared/ui/tabs';
import { AutomationRunLogPanel, useAutomationRunsQuery } from '../../automation';
import { useConnectionsQuery } from '../../connections';
import type { GiftRule, GiftRuleWriteInput } from '../api/gifts.types';
import { useGiftRuleReportQuery } from '../hooks/use-gift-rule-report';
import type { GiftRuleFormValues } from '../lib/gift-rule-form';
import { averageUnitCost, summariseGiftResults, type GiftResultCost } from '../lib/gift-rule-stats';
import { describeGiftRule } from '../lib/gift-rule-summary';
import { GiftRuleTestPanel } from './gift-rule-test-panel';

export interface GiftRuleRailProps {
  values: GiftRuleFormValues;
  /** The saved promotion; `null` for a new one. */
  rule: GiftRule | null;
  draft: GiftRuleWriteInput | null;
}

const costText = (costs: readonly GiftResultCost[], digits = false): string =>
  costs.length === 0
    ? '0'
    : costs
        .map((c) =>
          digits ? formatAmount(c.costNet, c.currency ?? '') : formatAmount(Math.round(c.costNet), c.currency ?? ''),
        )
        .join(' + ');

export function GiftRuleRail({ values, rule, draft }: GiftRuleRailProps): ReactElement {
  const copy = useMessages('gifts');
  const connections = useConnectionsQuery();
  const [tab, setTab] = useState<'test' | 'runs'>('test');
  const saved = rule !== null;
  const report = useGiftRuleReportQuery(saved);
  const runs = useAutomationRunsQuery(rule?.id ?? '', saved && tab === 'runs');

  const channelNames = values.channelIds.map(
    (id) => connections.data?.find((c) => c.id === id)?.name ?? id,
  );
  const sentence = describeGiftRule(
    {
      values,
      channelNames,
      amountText:
        values.basketMin.trim() === ''
          ? ''
          : formatAmount(Number(values.basketMin.replace(',', '.')), values.currency),
      formatDate: (date) => formatDate(date),
    },
    copy.detail.summary,
  );

  const results = useMemo(
    () =>
      rule === null || report.data === undefined ? null : summariseGiftResults(report.data.groups, rule.id),
    [rule, report.data],
  );
  const average = results === null ? null : averageUnitCost(results);

  return (
    <>
      <DetailSection title={copy.detail.summary.title} data-testid="gift-rule-summary">
        <p data-testid="gift-rule-summary-text">{sentence}</p>
      </DetailSection>

      {rule !== null ? (
        <DetailSection
          title={copy.detail.results.title}
          titleAside={<span className="text-muted">{copy.detail.results.range}</span>}
          data-testid="gift-rule-results"
        >
          {report.isError ? (
            <Alert tone="warning" density="compact" data-testid="gift-rule-results-failed">
              {copy.detail.results.failed}
            </Alert>
          ) : results === null ? (
            <p className="text-muted">…</p>
          ) : results.units === 0 ? (
            <p className="text-muted" data-testid="gift-rule-results-none">
              {copy.detail.results.none}
            </p>
          ) : (
            <>
              <dl className="gift-results">
                <div>
                  <dt>{copy.detail.results.given}</dt>
                  <dd data-testid="gift-rule-results-given">
                    {rule.effectiveCap === null
                      ? interpolate(copy.detail.results.pcs, { n: String(results.units) })
                      : `${results.units} ${interpolate(copy.detail.results.ofCap, { cap: String(rule.effectiveCap) })}`}
                  </dd>
                </div>
                <div>
                  <dt>{copy.detail.results.orders}</dt>
                  <dd data-testid="gift-rule-results-orders">{results.orders}</dd>
                </div>
                <div>
                  <dt>{copy.detail.results.cost}</dt>
                  <dd data-testid="gift-rule-results-cost">{costText(results.costs)}</dd>
                </div>
                <div>
                  <dt>{copy.detail.results.average}</dt>
                  <dd data-testid="gift-rule-results-average">
                    {average === null ? '-' : costText(average, true)}
                  </dd>
                </div>
              </dl>
              {results.unknownCostUnits > 0 ? (
                <p className="text-muted">
                  {interpolate(copy.detail.results.costPartial, { n: String(results.unknownCostUnits) })}
                </p>
              ) : null}
            </>
          )}
        </DetailSection>
      ) : null}

      <DetailSection data-testid="gift-rule-tools">
        {saved ? (
          <Tabs value={tab} onValueChange={(next) => setTab(next === 'runs' ? 'runs' : 'test')}>
            <TabsList aria-label={copy.detail.tabs.test}>
              <TabsTrigger value="test" data-testid="gift-rule-tab-test">
                {copy.detail.tabs.test}
              </TabsTrigger>
              <TabsTrigger value="runs" data-testid="gift-rule-tab-runs">
                {copy.detail.tabs.runs}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="test">
              <GiftRuleTestPanel ruleId={rule.id} draft={draft} showTitle={false} />
            </TabsContent>
            <TabsContent value="runs">
              <AutomationRunLogPanel
                log={runs.data ?? null}
                isLoading={runs.isLoading}
                error={runs.error}
              />
            </TabsContent>
          </Tabs>
        ) : (
          <GiftRuleTestPanel ruleId={null} draft={draft} />
        )}
      </DetailSection>
    </>
  );
}
