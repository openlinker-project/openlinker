/**
 * The rules on one trigger (#2364)
 *
 * Per-rule rows with an on/off state and a one-click toggle that PRESERVES the
 * fired log — turning a rule off is a change of intent, not a deletion, and the
 * copy says so where the operator decides rather than in a help page.
 *
 * ## Three things this component refuses to do
 *
 * **It does not present a rule as working when it cannot act.** Every rule
 * response carries `actionAvailability` per step; a rule with an unavailable
 * step renders `AutomationRuleAvailabilityNotice` inline, with the backend's
 * own reason. This is where an operator learns a rule they already saved does
 * nothing — the write path accepts all six actions deliberately, so the
 * response is the only place that truth surfaces.
 *
 * **It does not claim a rule has never matched.** Each row can open its own
 * fired log (#2366), which reads `recordingAvailable` first: while that is
 * false an empty list means the run write path has not landed, not that the
 * rule never fired. The log is fetched LAZILY, on expand — the query is
 * per-rule, so mounting one per row would issue N requests on page load for a
 * log that is empty in this build.
 *
 * **It does not arm a money-spending rule on one click.** Turning such a rule
 * ON is a standing grant of authority to act unattended, and the backend
 * refuses it without an explicit acknowledgement. Turning it OFF stays one
 * click: a disarmed rule spends nothing, so there is nothing to consent to.
 *
 * @module apps/web/src/features/automation/components
 */
import { useState, type ReactElement } from 'react';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { EmptyState } from '../../../shared/ui/feedback-state';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { Link } from 'react-router-dom';
import {
  AUTOMATION_ACTIVITY_COPY,
  AUTOMATION_RULES_COPY,
  AUTOMATION_RUN_LOG_COPY,
} from '../lib/automation.copy';
import { useAutomationRunsQuery } from '../hooks/use-automation-runs-query';
import { AutomationRunLogPanel } from './automation-run-log';
import { AutomationRuleAvailabilityNotice } from './automation-rule-availability-notice';
import type { AutomationRule } from '../api/automation.types';

export interface AutomationRulesListProps {
  rules: AutomationRule[];
  /** Whether the session may change anything here. Reads are open to operators. */
  canWrite: boolean;
  /** Render disabled-with-a-tooltip rather than hidden (demo read-only viewers). */
  readOnlyLocked: boolean;
  readOnlyMessage: string;
  onSetActive: (rule: AutomationRule, isActive: boolean, moneyAcknowledged?: boolean) => void;
  pendingRuleId: string | null;
  writeError: string | null;
}

/**
 * One rule's log, mounted only while its row is expanded.
 *
 * A child component rather than a hook call in the parent loop, because the
 * query is per-rule and hooks cannot be called conditionally — mounting the
 * child IS the laziness.
 */
function AutomationRuleRunLog({ ruleId }: { ruleId: string }): ReactElement {
  const runsQuery = useAutomationRunsQuery(ruleId);
  return (
    <AutomationRunLogPanel
      log={runsQuery.data ?? null}
      isLoading={runsQuery.isLoading}
      error={runsQuery.error}
    />
  );
}

export function AutomationRulesList({
  rules,
  canWrite,
  readOnlyLocked,
  readOnlyMessage,
  onSetActive,
  pendingRuleId,
  writeError,
}: AutomationRulesListProps): ReactElement {
  const [armingRule, setArmingRule] = useState<AutomationRule | null>(null);
  // One row open at a time: two open logs is two live queries for a read nobody
  // is comparing side by side.
  const [expandedRuleId, setExpandedRuleId] = useState<string | null>(null);

  if (rules.length === 0) {
    return (
      <EmptyState
        title={AUTOMATION_RULES_COPY.emptyTitle}
        message={AUTOMATION_RULES_COPY.emptyMessage}
      />
    );
  }

  function requestToggle(rule: AutomationRule): void {
    // Arming an irreversible rule needs the acknowledgement the backend will
    // otherwise refuse the write for. Disarming never does.
    if (!rule.isActive && rule.hasIrreversibleAction) {
      setArmingRule(rule);
      return;
    }
    onSetActive(rule, !rule.isActive);
  }

  return (
    <div className="page-section automation-rules">
      {writeError === null ? null : (
        <Alert tone="error" title={AUTOMATION_RULES_COPY.writeFailed}>
          {writeError}
        </Alert>
      )}
      {canWrite ? null : <Alert tone="info">{AUTOMATION_RULES_COPY.readOnly}</Alert>}

      <ul className="automation-rules__list">
        {rules.map((rule) => (
          <li key={rule.id} className="panel panel--dense automation-rules__item">
            <div className="panel__header">
              <div>
                <h3 className="section-title">{rule.name}</h3>
                <p className="muted-text">
                  <span className="mono-text">{rule.trigger}</span>
                </p>
              </div>
              <div className="automation-rules__state">
                <StatusBadge tone={rule.isActive ? 'success' : 'neutral'} withDot compact>
                  {rule.isActive ? AUTOMATION_RULES_COPY.active : AUTOMATION_RULES_COPY.inactive}
                </StatusBadge>
                {rule.hasIrreversibleAction ? (
                  <StatusBadge tone="warning" compact>
                    {AUTOMATION_RULES_COPY.moneyAckTitle}
                  </StatusBadge>
                ) : null}
                {canWrite || readOnlyLocked ? (
                  <ReadOnlyLock active={readOnlyLocked} message={readOnlyMessage}>
                    <Button
                      tone="secondary"
                      disabled={readOnlyLocked || pendingRuleId === rule.id}
                      onClick={() => requestToggle(rule)}
                    >
                      {rule.isActive
                        ? AUTOMATION_RULES_COPY.turnOff
                        : AUTOMATION_RULES_COPY.turnOn}
                    </Button>
                  </ReadOnlyLock>
                ) : null}
              </div>
            </div>

            <AutomationRuleAvailabilityNotice actionAvailability={rule.actionAvailability} />

            {rule.isActive ? <p className="muted-text">{AUTOMATION_RULES_COPY.turnOffHint}</p> : null}

            <Button
              type="button"
              tone="ghost"
              className="button--sm"
              aria-expanded={expandedRuleId === rule.id}
              onClick={() => setExpandedRuleId((prev) => (prev === rule.id ? null : rule.id))}
            >
              {expandedRuleId === rule.id
                ? AUTOMATION_RUN_LOG_COPY.hide
                : AUTOMATION_RUN_LOG_COPY.show}
            </Button>
            {expandedRuleId === rule.id ? <AutomationRuleRunLog ruleId={rule.id} /> : null}
            {/* Opens the cross-rule log already narrowed to this rule (#2386). */}
            <Link
              className="muted-text"
              to={`/automations/activity?ruleId=${encodeURIComponent(rule.id)}`}
            >
              {AUTOMATION_ACTIVITY_COPY.seeAllForRule}
            </Link>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={armingRule !== null}
        onOpenChange={(open) => {
          if (!open) setArmingRule(null);
        }}
        title={AUTOMATION_RULES_COPY.moneyAckTitle}
        description={AUTOMATION_RULES_COPY.moneyAckBody}
        confirmLabel={AUTOMATION_RULES_COPY.moneyAckConfirm}
        cancelLabel={AUTOMATION_RULES_COPY.cancel}
        tone="danger"
        onConfirm={() => {
          const rule = armingRule;
          setArmingRule(null);
          if (rule !== null) onSetActive(rule, true, true);
        }}
      />
    </div>
  );
}
