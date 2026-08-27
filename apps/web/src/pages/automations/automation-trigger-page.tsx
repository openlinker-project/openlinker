/**
 * The rules on one trigger (#2364)
 *
 * Reached from the index. `GET /automations` refuses to list without a trigger,
 * so this route's param IS the query — an unrecognised value is a 400 from the
 * API, and is caught here first so the operator gets a page rather than a
 * failed fetch.
 *
 * ## The fired-log probe, and what it is for
 *
 * One `GET /automations/:id/runs` for the FIRST rule only, purely to read
 * `recordingAvailable`. It is a build-wide fact, not a per-rule one, so asking
 * every rule would be N requests for one answer. While it reports false, the
 * list says OpenLinker cannot yet tell whether a rule has ever matched —
 * because an empty log then means the run write path has not landed, not that
 * nothing fired. Inferring "never matched" from it would be precisely the
 * false claim the flag exists to prevent.
 *
 * @module apps/web/src/pages/automations
 */
import type { ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { Alert } from '../../shared/ui/alert';
import { ErrorState, LoadingState } from '../../shared/ui/feedback-state';
import { useDemoMode } from '../../features/system/hooks/use-demo-mode';
import { useWriteAccess } from '../../shared/auth/use-permission';
import { NAV_DEMO_RESTRICTED_MESSAGE } from '../../shared/config/demo-mode';
import {
  AUTOMATION_ERROR_COPY,
  AUTOMATION_INDEX_COPY,
  AUTOMATION_RULES_COPY,
  AutomationRulesList,
  describeTrigger,
  isAutomationTrigger,
  useAutomationRulesQuery,
  useAutomationRunsQuery,
  useSetAutomationActiveMutation,
  type AutomationRule,
} from '../../features/automation';

export function AutomationTriggerPage(): ReactElement {
  const { trigger } = useParams<{ trigger: string }>();
  const demoMode = useDemoMode();
  // The documented primitive, never an inline `role === 'admin'` compare: the
  // role field is typed `string`, so a typo would type-check and silently
  // evaluate false. `automations:write` mirrors the controller's admin-only
  // writes exactly; reads stay open to operators.
  const write = useWriteAccess('automations:write', demoMode);

  const isKnownTrigger = isAutomationTrigger(trigger);
  // The placeholder satisfies the union so the hook can run unconditionally;
  // `enabled` is what stops it being FETCHED. Without the flag an unrecognised
  // route param issues a real request for `order.packed` and caches it under
  // that trigger's key — data for a page the operator never opened.
  const rulesQuery = useAutomationRulesQuery(
    isKnownTrigger ? trigger : 'order.packed',
    isKnownTrigger,
  );
  const firstRuleId = rulesQuery.data?.items[0]?.id;
  const runsQuery = useAutomationRunsQuery(firstRuleId ?? '', Boolean(firstRuleId));
  const setActive = useSetAutomationActiveMutation();

  const described = describeTrigger(trigger ?? '');

  const backLink = (
    <Link className="button button--secondary" to="/automations">
      {AUTOMATION_RULES_COPY.backToIndex}
    </Link>
  );

  if (!isKnownTrigger) {
    return (
      <PageLayout
        eyebrow={AUTOMATION_RULES_COPY.eyebrow}
        title={described.label}
        actions={backLink}
      >
        <ErrorState
          title={AUTOMATION_ERROR_COPY.rulesTitle}
          message={AUTOMATION_ERROR_COPY.vocabularyMessage}
        />
      </PageLayout>
    );
  }

  function handleSetActive(
    rule: AutomationRule,
    isActive: boolean,
    moneyAcknowledged?: boolean,
  ): void {
    setActive.mutate({ rule, isActive, moneyAcknowledged });
  }

  return (
    <PageLayout
      eyebrow={AUTOMATION_RULES_COPY.eyebrow}
      title={described.label}
      description={described.description ?? undefined}
      actions={backLink}
    >
      {rulesQuery.isLoading ? (
        <LoadingState
          title={AUTOMATION_ERROR_COPY.loadingTitle}
          message={AUTOMATION_ERROR_COPY.loadingMessage}
        />
      ) : rulesQuery.error ? (
        <ErrorState
          title={AUTOMATION_ERROR_COPY.rulesTitle}
          message={rulesQuery.error.message}
        />
      ) : (
        <>
          {(rulesQuery.data?.droppedCount ?? 0) > 0 ? (
            <Alert tone="warning">
              {AUTOMATION_INDEX_COPY.droppedRows(rulesQuery.data?.droppedCount ?? 0)}
            </Alert>
          ) : null}
          <AutomationRulesList
            rules={rulesQuery.data?.items ?? []}
            canWrite={write.canWrite}
            readOnlyLocked={write.demoReadOnly}
            readOnlyMessage={NAV_DEMO_RESTRICTED_MESSAGE}
            // Only a SETTLED `recordingAvailable: false` justifies the notice;
            // a null (unreadable) log or a still-loading one asserts nothing.
            firingsUnrecorded={runsQuery.data?.recordingAvailable === false}
            onSetActive={handleSetActive}
            pendingRuleId={setActive.isPending ? (setActive.variables?.rule.id ?? null) : null}
            writeError={setActive.error?.message ?? null}
          />
        </>
      )}
    </PageLayout>
  );
}
