/**
 * Retention Studio (#4289)
 *
 * Where an operator SETS the buyer-data rules and SEES what they do to the
 * data: the age strip with two draggable cut-offs, the exact period inputs, the
 * living example order and the plan in numbers. One component serves the
 * general page, each connection's tab, the connection edit and, without the
 * strip and the plan, the new-connection wizard (a connection that does not
 * exist yet has no orders to draw).
 *
 * It is controlled and holds no rules of its own: the caller owns the value and
 * the plan query (it needs the plan's freshness to unlock its master switch).
 *
 * @module apps/web/src/features/buyer-data/components
 */
import { useMemo, useState, type ReactElement } from 'react';
import { useMessages } from '../../../shared/i18n';
import { SegmentedControl } from '../../../shared/ui/segmented-control';
import { isBuyerDataEraseMode, type BuyerDataRules } from '../api/buyer-data.types';
import { useBuyerDataAgeHistogram } from '../hooks/use-buyer-data-age-histogram';
import type { BuyerDataPlan } from '../hooks/use-buyer-data-plan';
import { validateBuyerDataRules } from '../lib/buyer-data-config';
import { estimateZoneCounts, type RetentionCuts } from '../lib/retention-scale';
import { AgeStrip, type StripCounts } from './age-strip';
import { PeriodInput } from './period-input';
import { PlanPanel } from './plan-panel';
import { RecordCard } from './record-card';

export interface RetentionStudioProps {
  rules: BuyerDataRules;
  onChange: (next: BuyerDataRules) => void;
  /** Scope of the strip and the plan; absent = every connection. */
  connectionId?: string;
  /** Null for the compact variant, which asks the server nothing. */
  plan: BuyerDataPlan | null;
  /** `compact` drops the strip and the plan: inputs and the example order only. */
  variant?: 'full' | 'compact';
  disabled?: boolean;
  /** The values are inherited (ghosted); changing one makes them the scope's own. */
  ghost?: boolean;
  /** Id prefix keeping test ids unique when two studios share a page. */
  name: string;
}

export function RetentionStudio({
  rules,
  onChange,
  connectionId,
  plan,
  variant = 'full',
  disabled = false,
  ghost = false,
  name,
}: RetentionStudioProps): ReactElement {
  const copy = useMessages('buyer-data').rules;
  const periodCopy = useMessages('buyer-data').period;
  const full = variant === 'full';
  const histogramQuery = useBuyerDataAgeHistogram(connectionId, { enabled: full });
  const [activeAge, setActiveAge] = useState<number | null>(null);

  const issues = validateBuyerDataRules(rules);
  const hideError = issues.includes('hide-range') ? periodCopy.errorRange : undefined;
  const eraseError = issues.includes('erase-range')
    ? periodCopy.errorRange
    : issues.includes('erase-before-hide')
      ? copy.eraseBeforeHide
      : undefined;

  const histogram = histogramQuery.data;
  const histogramState = histogramQuery.isError
    ? 'error'
    : histogram === undefined
      ? 'loading'
      : 'ready';

  const counts = useMemo<StripCounts | null>(() => {
    if (plan?.fresh === true && plan.data !== undefined) {
      const { totalOrders, total, toErase } = plan.data;
      return {
        kept: Math.max(0, totalOrders - total),
        hidden: Math.max(0, total - toErase),
        erased: toErase,
        estimated: false,
        calculating: false,
      };
    }
    if (histogram !== undefined) {
      return {
        ...estimateZoneCounts(histogram.buckets, rules),
        estimated: true,
        calculating: plan?.calculating ?? false,
      };
    }
    if (plan?.data !== undefined) {
      const { totalOrders, total, toErase } = plan.data;
      return {
        kept: Math.max(0, totalOrders - total),
        hidden: Math.max(0, total - toErase),
        erased: toErase,
        estimated: true,
        calculating: true,
      };
    }
    return null;
  }, [plan, histogram, rules]);

  const defaultAge = useMemo(() => {
    if (!full) return 730;
    const oldest = [...(histogram?.buckets ?? [])]
      .filter((bucket) => bucket.visible > 0)
      .sort((a, b) => b.ageMonths - a.ageMonths)[0];
    return oldest === undefined ? 0 : Math.min(3650, oldest.ageMonths * 30 + 15);
  }, [full, histogram]);

  function setCuts(cuts: RetentionCuts): void {
    onChange({ ...rules, ...cuts });
  }

  return (
    <div
      className={`retention-studio retention-studio--${variant}${ghost ? ' retention-studio--ghost' : ''}`}
      data-testid={`retention-studio-${name}`}
    >
      <div className="retention-studio__main">
        {full ? (
          <AgeStrip
            hideAfterDays={rules.hideAfterDays}
            eraseAfterDays={rules.eraseAfterDays}
            histogram={histogram}
            histogramState={histogramState}
            counts={counts}
            onChange={setCuts}
            onActive={setActiveAge}
            disabled={disabled}
            ghost={ghost}
          />
        ) : null}

        <div className="retention-studio__inputs">
          <PeriodInput
            name={`${name}-hide`}
            label={copy.hideLabel}
            description={copy.hideDescription}
            neverLabel={copy.neverLabel}
            days={rules.hideAfterDays}
            onChange={(days) =>
              setCuts({ hideAfterDays: days, eraseAfterDays: rules.eraseAfterDays })
            }
            error={hideError}
            disabled={disabled}
          />
          <PeriodInput
            name={`${name}-erase`}
            label={copy.eraseLabel}
            description={copy.eraseDescription}
            neverLabel={copy.neverLabel}
            days={rules.eraseAfterDays}
            onChange={(days) =>
              setCuts({ hideAfterDays: rules.hideAfterDays, eraseAfterDays: days })
            }
            error={eraseError}
            disabled={disabled}
          />
        </div>

        {rules.eraseAfterDays > 0 ? (
          <div className="retention-studio__mode">
            <span className="period-field__label" id={`${name}-mode-label`}>
              {copy.modeLabel}
            </span>
            <SegmentedControl
              aria-labelledby={`${name}-mode-label`}
              value={rules.mode}
              onChange={(value) => {
                if (isBuyerDataEraseMode(value)) onChange({ ...rules, mode: value });
              }}
              options={[
                { value: 'personal-data', label: copy.modePersonal, disabled },
                { value: 'whole-order', label: copy.modeWhole, disabled },
              ]}
            />
            <p className="period-field__hint">
              {rules.mode === 'whole-order'
                ? copy.modeDescriptionWhole
                : copy.modeDescriptionPersonal}
            </p>
            <p className="retention-studio__irreversible">{copy.irreversibleBody}</p>
          </div>
        ) : null}

        {full ? null : (
          <RecordCard
            hideAfterDays={rules.hideAfterDays}
            eraseAfterDays={rules.eraseAfterDays}
            mode={rules.mode}
            handleAgeDays={activeAge}
            defaultAgeDays={defaultAge}
          />
        )}
      </div>

      {full ? (
        <div className="retention-studio__side">
          {plan !== null ? (
            <PlanPanel plan={plan} mode={rules.mode} invalid={issues.length > 0} />
          ) : null}
          <RecordCard
            hideAfterDays={rules.hideAfterDays}
            eraseAfterDays={rules.eraseAfterDays}
            mode={rules.mode}
            handleAgeDays={activeAge}
            defaultAgeDays={defaultAge}
          />
        </div>
      ) : null}
    </div>
  );
}
