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
import { navDemoRestrictedMessage } from '../../shared/config/demo-mode';
import { Button } from '../../shared/ui/button';
import { Chip } from '../../shared/ui/chip';
import { Alert } from '../../shared/ui/alert';
import { Select } from '../../shared/ui/select';
import { FormField } from '../../shared/ui/form-field';
import { Input } from '../../shared/ui/input';
import { EmptyState, ErrorState, LoadingState } from '../../shared/ui/feedback-state';
import { interpolate, useMessages } from '../../shared/i18n';
import {
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
import { describeApiError } from '../../shared/api/describe-api-error';

/** Server-side cap; a numbered pager is impossible because the envelope has no `total`. */
const PAGE_SIZE = 50;

export function AutomationActivityPage(): ReactElement {
  const messages = useMessages('automation');
  const copy = messages.activity;
  const failureCopy = messages.failure;
  const pageCopy = messages.activityPage;
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
  // `undefined` while loading / unreadable — only an explicit `false` means
  // "this build does not record firings".
  const recordingAvailable = feedQuery.data?.recordingAvailable;
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
      {copy.backToIndex}
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
    // Checked BEFORE every other branch, exactly as `AutomationRunLogPanel`
    // does: while `recordingAvailable` is false an empty list says nothing at
    // all about whether anything fired, so "Nothing has run yet" would be a
    // false statement about the operator's own automations. The backend ships
    // the correct sentence in `note`; it leads.
    if (recordingAvailable === false) {
      return (
        <Alert tone="info">
          {feedQuery.data?.note ?? copy.recordingUnavailableFallback}
        </Alert>
      );
    }
    if (filters.outcome === 'blocked') {
      return (
        <EmptyState
          title={copy.emptyBlockedTitle}
          message={copy.emptyBlockedMessage}
        />
      );
    }
    if (isFiltered) {
      return (
        <EmptyState
          title={copy.emptyFilteredTitle}
          message={copy.emptyFilteredMessage}
        />
      );
    }
    // Waits for the summary to SETTLE — claiming "you have no automations"
    // while the counts are still loading would flash a false statement at an
    // operator who has ten.
    if (!summaryQuery.isLoading && !summaryQuery.error && !hasAnyRule) {
      return (
        <EmptyState
          title={copy.emptyNoRulesTitle}
          message={copy.emptyNoRulesMessage}
          action={
            <Link className="button button--primary" to="/automations">
              {copy.emptyNoRulesAction}
            </Link>
          }
        />
      );
    }
    return (
      <EmptyState
        title={copy.emptyNoRunsTitle}
        message={copy.emptyNoRunsMessage}
      />
    );
  })();

  return (
    <PageLayout
      eyebrow={copy.eyebrow}
      title={copy.title}
      description={copy.description}
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
            ? failureCopy.clearAttentionFilter
            : failureCopy.attentionFilter}
        </Chip>
      </div>
      {filters.ruleId === undefined ? null : (
        <div className="automation-activity__active-rule">
          <Chip active tone="info" onClick={() => patch('ruleId', '')}>
            {interpolate(pageCopy.ruleFilterChip, { ruleId: filters.ruleId })}
          </Chip>
        </div>
      )}

      <div className="automation-activity__filters">
        <FormField label={copy.filterTrigger} name="activity-trigger">
          <Select
            value={filters.trigger ?? ''}
            onChange={(event) => patch('trigger', event.target.value)}
          >
            <option value="">{copy.filterAll}</option>
            {AUTOMATION_TRIGGER_VALUES.map((trigger) => (
              <option key={trigger} value={trigger}>
                {describeTrigger(trigger).label}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField label={copy.filterOutcome} name="activity-outcome">
          <Select
            value={filters.outcome ?? ''}
            onChange={(event) => patch('outcome', event.target.value)}
          >
            <option value="">{copy.filterAll}</option>
            {/*
              All four, including `blocked` — a filter that silently omits one of
              four documented outcomes is its own lie. It matches nothing today,
              and the empty state says why.
            */}
            {AUTOMATION_RUN_OUTCOME_VALUES.map((outcome) => (
              <option key={outcome} value={outcome}>
                {messages.runOutcomes[outcome]}
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
        <FormField label={copy.filterOrder} name="activity-order">
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

        <FormField label={copy.filterFrom} name="activity-from">
          <Input
            type="date"
            value={(filters.from ?? '').slice(0, 10)}
            onChange={(event) => patch('from', event.target.value)}
          />
        </FormField>

        <FormField label={copy.filterTo} name="activity-to">
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
            {copy.clearFilters}
          </Button>
        ) : null}
      </div>

      {feedQuery.isLoading ? (
        <LoadingState title={copy.loadingTitle} message="" />
      ) : feedQuery.error ? (
        <ErrorState
          title={copy.errorTitle}
          message={describeApiError(feedQuery.error, 'automation')}
        />
      ) : (
        <>
          <AutomationActivityTable
          canWrite={write.canWrite}
          readOnlyLocked={write.demoReadOnly}
          readOnlyMessage={navDemoRestrictedMessage()} runs={runs} emptyState={emptyState} />

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
              {pageCopy.previous}
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
              {pageCopy.next}
            </Button>
          </div>
        </>
      )}

      <p className="muted-text">{copy.retentionFooter}</p>
    </PageLayout>
  );
}
