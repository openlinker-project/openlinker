/**
 * The global automation run log (#2386, spec §5.6 c)
 *
 * Replaces the #2364 placeholder. A CHILD route of `/automations` with no nav
 * entry of its own — the parent already has one — reached from the `/automations`
 * header and from a rule page pre-filtered.
 *
 * ## Four empty states, and none of them guesses
 *
 * "No automations at all", "rules exist but none has fired", "a filter excluded
 * everything" and "you filtered by an outcome this build cannot record" are four
 * different operator situations with four different next actions. Collapsing any
 * two makes a false statement about the operator's own setup — the defect this
 * wave keeps closing.
 *
 * ## The footer says only what is true
 *
 * Spec §5.6(c) asks for a 90-day retention sentence; nothing prunes
 * `automation_runs`, so that sentence would assert a deletion that never
 * happened — and its own purpose inverts, since it exists to explain an empty
 * older window that will not be empty. See `retentionFooter` in the copy module.
 *
 * @module apps/web/src/pages/automations
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { useWriteAccess } from '../../shared/auth/use-permission';
import { useDemoMode } from '../../features/system/hooks/use-demo-mode';
import { NAV_DEMO_RESTRICTED_MESSAGE } from '../../shared/config/demo-mode';
import { Button } from '../../shared/ui/button';
import { Chip } from '../../shared/ui/chip';
import { AUTOMATION_FAILURE_COPY } from '../../features/automation';
import { Select } from '../../shared/ui/select';
import { FormField } from '../../shared/ui/form-field';
import { Input } from '../../shared/ui/input';
import { EmptyState, ErrorState, LoadingState } from '../../shared/ui/feedback-state';
import {
  AUTOMATION_ACTIVITY_COPY,
  AUTOMATION_RUN_OUTCOME_COPY,
  AUTOMATION_RUN_OUTCOME_VALUES,
  AUTOMATION_TRIGGER_VALUES,
  AutomationActivityTable,
  clearAutomationActivityFilters,
  describeTrigger,
  hasActiveAutomationActivityFilters,
  readAutomationActivityFilters,
  readAutomationActivityOffset,
  setAutomationActivityFilterParam,
  setAutomationActivityOffsetParam,
  useAutomationRunFeedQuery,
  useAutomationSummaryQuery,
} from '../../features/automation';

/** Server-side cap; a numbered pager is impossible because the envelope has no `total`. */
const PAGE_SIZE = 50;

export function AutomationActivityPage(): ReactElement {
  const demoMode = useDemoMode();
  // The documented primitive — never an inline `role === 'admin'` compare. The
  // two run actions are writes, so they mirror the controller's admin-only
  // routes; the log itself stays readable by an operator.
  const write = useWriteAccess('automations:write', demoMode);
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(
    () => readAutomationActivityFilters(searchParams),
    [searchParams],
  );
  const offset = readAutomationActivityOffset(searchParams);
  const isFiltered = hasActiveAutomationActivityFilters(filters);

  const feedQuery = useAutomationRunFeedQuery(filters, { limit: PAGE_SIZE, offset });
  const summaryQuery = useAutomationSummaryQuery();

  // Uncommitted draft for the one free-text filter. Re-seeded from the URL so a
  // back/forward navigation or a Clear does not leave a stale string on screen.
  const [orderDraft, setOrderDraft] = useState(filters.orderId ?? '');
  useEffect(() => {
    setOrderDraft(filters.orderId ?? '');
  }, [filters.orderId]);

  const runs = feedQuery.data?.runs ?? [];
  const hasAnyRule = (summaryQuery.data?.items ?? []).some((entry) => entry.ruleCount > 0);

  function patch(key: Parameters<typeof setAutomationActivityFilterParam>[1], value: string): void {
    setSearchParams(setAutomationActivityFilterParam(searchParams, key, value), {
      replace: true,
    });
  }

  function commitOrderDraft(): void {
    const next = orderDraft.trim();
    if (next === (filters.orderId ?? '')) return;
    patch('orderId', next);
  }

  const header = (
    <Link className="button button--secondary" to="/automations">
      {AUTOMATION_ACTIVITY_COPY.backToIndex}
    </Link>
  );

  /**
   * The four branches, in order of specificity.
   *
   * `Blocked` is checked first because it is the one case where an empty result
   * is not evidence of anything: that outcome has no producer in this build, so
   * "nothing matched" would read as "no collisions have occurred".
   */
  const emptyState = ((): ReactElement => {
    if (filters.outcome === 'blocked') {
      return (
        <EmptyState
          title={AUTOMATION_ACTIVITY_COPY.emptyBlockedTitle}
          message={AUTOMATION_ACTIVITY_COPY.emptyBlockedMessage}
        />
      );
    }
    if (isFiltered) {
      return (
        <EmptyState
          title={AUTOMATION_ACTIVITY_COPY.emptyFilteredTitle}
          message={AUTOMATION_ACTIVITY_COPY.emptyFilteredMessage}
        />
      );
    }
    // Waits for the summary to SETTLE — claiming "you have no automations"
    // while the counts are still loading would flash a false statement at an
    // operator who has ten.
    if (!summaryQuery.isLoading && !summaryQuery.error && !hasAnyRule) {
      return (
        <EmptyState
          title={AUTOMATION_ACTIVITY_COPY.emptyNoRulesTitle}
          message={AUTOMATION_ACTIVITY_COPY.emptyNoRulesMessage}
          action={
            <Link className="button button--primary" to="/automations">
              {AUTOMATION_ACTIVITY_COPY.emptyNoRulesAction}
            </Link>
          }
        />
      );
    }
    return (
      <EmptyState
        title={AUTOMATION_ACTIVITY_COPY.emptyNoRunsTitle}
        message={AUTOMATION_ACTIVITY_COPY.emptyNoRunsMessage}
      />
    );
  })();

  return (
    <PageLayout
      eyebrow={AUTOMATION_ACTIVITY_COPY.eyebrow}
      title={AUTOMATION_ACTIVITY_COPY.title}
      description={AUTOMATION_ACTIVITY_COPY.description}
      actions={header}
    >
      {/*
        `ruleId` has no picker — it arrives via the rule row's "See all runs"
        deep link. Without this chip the list is narrowed to one rule with
        nothing on screen saying why, which is the same silent-false-claim shape
        the four empty states exist to prevent, one level up.
      */}
      {/*
        The attention toggle (#2387). A chip rather than a Select: it is a
        two-state narrowing, and it must stay visible while active for the same
        reason the rule chip does — a filtered-empty table with nothing on screen
        saying why reads as "nothing has failed", which is a false claim about
        the operator's own data.
      */}
      <div className="automation-activity__active-rule">
        <Chip
          active={filters.attentionOnly === true}
          tone="info"
          onClick={() => patch('attentionOnly', filters.attentionOnly === true ? '' : 'true')}
        >
          {filters.attentionOnly === true
            ? AUTOMATION_FAILURE_COPY.clearAttentionFilter
            : AUTOMATION_FAILURE_COPY.attentionFilter}
        </Chip>
      </div>
      {filters.ruleId === undefined ? null : (
        <div className="automation-activity__active-rule">
          <Chip active tone="info" onClick={() => patch('ruleId', '')}>
            {`${AUTOMATION_ACTIVITY_COPY.filterRule}: ${filters.ruleId} · ${AUTOMATION_ACTIVITY_COPY.clearRuleFilter}`}
          </Chip>
        </div>
      )}

      <div className="automation-activity__filters">
        <FormField label={AUTOMATION_ACTIVITY_COPY.filterTrigger} name="activity-trigger">
          <Select
            value={filters.trigger ?? ''}
            onChange={(event) => patch('trigger', event.target.value)}
          >
            <option value="">{AUTOMATION_ACTIVITY_COPY.filterAll}</option>
            {AUTOMATION_TRIGGER_VALUES.map((trigger) => (
              <option key={trigger} value={trigger}>
                {describeTrigger(trigger).label}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField label={AUTOMATION_ACTIVITY_COPY.filterOutcome} name="activity-outcome">
          <Select
            value={filters.outcome ?? ''}
            onChange={(event) => patch('outcome', event.target.value)}
          >
            <option value="">{AUTOMATION_ACTIVITY_COPY.filterAll}</option>
            {/*
              All four, including `blocked` — a filter that silently omits one of
              four documented outcomes is its own lie. It matches nothing today,
              and the empty state says why.
            */}
            {AUTOMATION_RUN_OUTCOME_VALUES.map((outcome) => (
              <option key={outcome} value={outcome}>
                {AUTOMATION_RUN_OUTCOME_COPY[outcome]}
              </option>
            ))}
          </Select>
        </FormField>

        {/*
          The only free-text filter on the page. Held locally and committed on
          blur/Enter: writing it through on every keystroke changes the query key
          per character, so a 30-character order id would issue ~30 requests and
          reset the offset 30 times. Local draft state is what § Local UI State
          is for.
        */}
        <FormField label={AUTOMATION_ACTIVITY_COPY.filterOrder} name="activity-order">
          <Input
            value={orderDraft}
            onChange={(event) => setOrderDraft(event.target.value)}
            onBlur={() => commitOrderDraft()}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              commitOrderDraft();
            }}
          />
        </FormField>

        <FormField label={AUTOMATION_ACTIVITY_COPY.filterFrom} name="activity-from">
          <Input
            type="date"
            value={(filters.from ?? '').slice(0, 10)}
            onChange={(event) => patch('from', event.target.value)}
          />
        </FormField>

        <FormField label={AUTOMATION_ACTIVITY_COPY.filterTo} name="activity-to">
          <Input
            type="date"
            value={(filters.to ?? '').slice(0, 10)}
            onChange={(event) => patch('to', event.target.value)}
          />
        </FormField>

        {isFiltered ? (
          <Button
            tone="secondary"
            className="button--sm"
            onClick={() =>
              setSearchParams(clearAutomationActivityFilters(searchParams), { replace: true })
            }
          >
            {AUTOMATION_ACTIVITY_COPY.clearFilters}
          </Button>
        ) : null}
      </div>

      {feedQuery.isLoading ? (
        <LoadingState title={AUTOMATION_ACTIVITY_COPY.loadingTitle} message="" />
      ) : feedQuery.error ? (
        <ErrorState
          title={AUTOMATION_ACTIVITY_COPY.errorTitle}
          message={feedQuery.error.message}
        />
      ) : (
        <>
          <AutomationActivityTable
          canWrite={write.canWrite}
          readOnlyLocked={write.demoReadOnly}
          readOnlyMessage={NAV_DEMO_RESTRICTED_MESSAGE} runs={runs} emptyState={emptyState} />

          {/* Next/prev only: the envelope carries `hasMore`, deliberately no `total`. */}
          <div className="automation-activity__pager">
            <Button
              tone="secondary"
              className="button--sm"
              disabled={offset <= 0}
              onClick={() =>
                setSearchParams(
                  setAutomationActivityOffsetParam(searchParams, offset - PAGE_SIZE),
                  { replace: true },
                )
              }
            >
              Previous
            </Button>
            <Button
              tone="secondary"
              className="button--sm"
              disabled={feedQuery.data?.hasMore !== true}
              onClick={() =>
                setSearchParams(
                  setAutomationActivityOffsetParam(searchParams, offset + PAGE_SIZE),
                  { replace: true },
                )
              }
            >
              Next
            </Button>
          </div>
        </>
      )}

      <p className="muted-text">{AUTOMATION_ACTIVITY_COPY.retentionFooter}</p>
    </PageLayout>
  );
}
