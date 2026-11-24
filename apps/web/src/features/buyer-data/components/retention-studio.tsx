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
import { useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { useFormat, useMessages } from '../../../shared/i18n';
import { Button } from '../../../shared/ui/button';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '../../../shared/ui/dialog';
import { SegmentedControl } from '../../../shared/ui/segmented-control';
import { isBuyerDataEraseMode, type BuyerDataRules } from '../api/buyer-data.types';
import { useBuyerDataAgeHistogram } from '../hooks/use-buyer-data-age-histogram';
import { useBuyerDataFollowersHistogram } from '../hooks/use-buyer-data-followers';
import type { BuyerDataPlan } from '../hooks/use-buyer-data-plan';
import { validateBuyerDataRules } from '../lib/buyer-data-config';
import { estimateZoneCounts, type RetentionCuts } from '../lib/retention-scale';
import { AgeStrip, type StripCounts } from './age-strip';
import { PeriodInput } from './period-input';
import { PlanPanel } from './plan-panel';
import { RecordCard } from './record-card';
import { TickingNumber } from './ticking-number';

export interface RetentionStudioProps {
  rules: BuyerDataRules;
  onChange: (next: BuyerDataRules) => void;
  /** Scope of the strip and the plan; absent = every connection. */
  connectionId?: string;
  /** Null for the compact variant, which asks the server nothing. */
  plan: BuyerDataPlan | null;
  /** Defaults tab: draw and count only the connections that follow the defaults. */
  followerIds?: readonly string[];
  /** One line saying whose orders the plan counts. */
  planNote?: string;
  /** `compact` drops the strip and the plan: inputs and the example order only. */
  variant?: 'full' | 'compact';
  disabled?: boolean;
  /** The values are inherited (ghosted); changing one makes them the scope's own. */
  ghost?: boolean;
  /** The master switch (and its status line); lives at the head of the consequences rail. */
  railHead?: ReactNode;
  /** Whatever closes the workbench (the channel comparison); scrolls under the sticky rail. */
  footer?: ReactNode;
  /** Id prefix keeping test ids unique when two studios share a page. */
  name: string;
}

export function RetentionStudio({
  rules,
  onChange,
  connectionId,
  plan,
  followerIds,
  planNote,
  variant = 'full',
  disabled = false,
  ghost = false,
  railHead,
  footer,
  name,
}: RetentionStudioProps): ReactElement {
  const copy = useMessages('buyer-data').rules;
  const periodCopy = useMessages('buyer-data').period;
  const studioCopy = useMessages('buyer-data').studio;
  const planCopy = useMessages('buyer-data').plan;
  const format = useFormat();
  const [planOpen, setPlanOpen] = useState(false);
  const full = variant === 'full';
  const singleHistogram = useBuyerDataAgeHistogram(connectionId, {
    enabled: full && followerIds === undefined,
  });
  const followersHistogram = useBuyerDataFollowersHistogram(followerIds ?? [], {
    enabled: full && followerIds !== undefined,
  });
  const histogramQuery = followerIds === undefined ? singleHistogram : followersHistogram;
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
    // The plan only counts what is still to be done; what the job already hid or
    // erased is in the histogram and belongs in the zone it sits in.
    let alreadyHidden = 0;
    let alreadyErased = 0;
    for (const bucket of histogram?.buckets ?? []) {
      alreadyHidden += bucket.hidden;
      alreadyErased += bucket.erased;
    }
    if (plan?.fresh === true && plan.data !== undefined) {
      const { totalOrders, total, toErase } = plan.data;
      return {
        kept: Math.max(0, totalOrders - total),
        hidden: Math.max(0, total - toErase) + alreadyHidden,
        erased: toErase + alreadyErased,
        alreadyHidden,
        alreadyErased,
        estimated: false,
        calculating: false,
      };
    }
    if (histogram !== undefined) {
      return {
        ...estimateZoneCounts(histogram.buckets, rules),
        alreadyHidden,
        alreadyErased,
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
        alreadyHidden: 0,
        alreadyErased: 0,
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

  const periodInputs = (
    <div className="retention-studio__inputs">
      <PeriodInput
        name={`${name}-hide`}
        label={copy.hideLabel}
        description={copy.hideDescription}
        neverLabel={copy.neverLabel}
        days={rules.hideAfterDays}
        onChange={(days) => setCuts({ hideAfterDays: days, eraseAfterDays: rules.eraseAfterDays })}
        error={hideError}
        restoreAtLeastDays={90}
        disabled={disabled}
      />
      <PeriodInput
        name={`${name}-erase`}
        label={copy.eraseLabel}
        description={copy.eraseDescription}
        neverLabel={copy.neverLabel}
        days={rules.eraseAfterDays}
        onChange={(days) => setCuts({ hideAfterDays: rules.hideAfterDays, eraseAfterDays: days })}
        error={eraseError}
        restoreAtLeastDays={Math.max(365, rules.hideAfterDays)}
        disabled={disabled}
        footnote={rules.eraseAfterDays > 0 ? copy.irreversibleBody : undefined}
      />
    </div>
  );

  const modeControl =
    rules.eraseAfterDays > 0 ? (
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
          {rules.mode === 'whole-order' ? copy.modeDescriptionWhole : copy.modeDescriptionPersonal}
        </p>
      </div>
    ) : null;

  const recordCard = (
    <RecordCard
      hideAfterDays={rules.hideAfterDays}
      eraseAfterDays={rules.eraseAfterDays}
      mode={rules.mode}
      handleAgeDays={activeAge}
      defaultAgeDays={defaultAge}
    />
  );
  const planPanel =
    plan !== null ? (
      <PlanPanel plan={plan} mode={rules.mode} invalid={issues.length > 0} note={planNote} />
    ) : null;

  const summaryNumber = (n: number | undefined): ReactNode =>
    n === undefined ? '–' : <TickingNumber value={n} format={format.number} />;

  return (
    <div
      className={`retention-studio retention-studio--${variant}${ghost ? ' retention-studio--ghost' : ''}`}
      data-testid={`retention-studio-${name}`}
    >
      <div className="retention-studio__main">
        {full ? (
          <section className="retention-studio__instrument">
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
            <div className="retention-studio__deck">
              {periodInputs}
              {modeControl}
            </div>
          </section>
        ) : (
          <>
            {periodInputs}
            {modeControl}
            {recordCard}
          </>
        )}
        {footer}
      </div>

      {full ? (
        <aside className="retention-studio__side" data-testid="retention-rail">
          {railHead !== undefined ? (
            <div className="retention-studio__rail-head">{railHead}</div>
          ) : null}
          {planPanel !== null ? (
            <div className="retention-studio__rail-plan">{planPanel}</div>
          ) : null}
          <div className="retention-studio__rail-card">{recordCard}</div>
        </aside>
      ) : null}

      {full ? (
        <div className="retention-studio__summary" data-testid="studio-summary">
          <dl>
            <div>
              <dt>{planCopy.stays}</dt>
              <dd>{summaryNumber(counts?.kept)}</dd>
            </div>
            <div>
              <dt>{planCopy.hidden}</dt>
              <dd>{summaryNumber(counts?.hidden)}</dd>
            </div>
            <div>
              <dt>{planCopy.erased}</dt>
              <dd>{summaryNumber(counts?.erased)}</dd>
            </div>
          </dl>
          <Button
            type="button"
            tone="secondary"
            className="button--sm"
            data-testid="studio-summary-open"
            onClick={() => setPlanOpen(true)}
          >
            {studioCopy.viewPlan}
          </Button>
          <Dialog open={planOpen} onOpenChange={setPlanOpen}>
            <DialogContent className="retention-studio__sheet" aria-describedby={undefined}>
              <DialogTitle>{studioCopy.sheetTitle}</DialogTitle>
              {planPanel}
              {recordCard}
              <DialogClose asChild>
                <Button type="button" tone="secondary">
                  {studioCopy.close}
                </Button>
              </DialogClose>
            </DialogContent>
          </Dialog>
        </div>
      ) : null}
    </div>
  );
}
