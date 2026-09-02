/**
 * Why a saved rule cannot act (#2364)
 *
 * The per-rule counterpart of the index availability panel, and the answer to
 * "how does an operator learn that the rule they just saved can do nothing?".
 *
 * The write path deliberately ACCEPTS all six actions — the executors are
 * registered rather than omitted, so a firing is loud rather than silent —
 * which means the saved rule's own response is where the truth lives. Every
 * rule response carries `actionAvailability` in its own step order; this reads
 * it and says so on the row.
 *
 * Two tones, because two different things are true. A step that cannot run at
 * all makes the whole rule inert when it matches (`error`). A step that runs in
 * some firing processes and not others makes it conditional (`warning`) — the
 * rule really does work, sometimes, and calling that "broken" would be as
 * wrong as calling it ready.
 *
 * @module apps/web/src/features/automation/components
 */
import type { ReactElement } from 'react';
import { Alert } from '../../../shared/ui/alert';
import { AUTOMATION_AVAILABILITY_COPY } from '../lib/automation.copy';
import { readRuleAvailability } from '../lib/action-availability';
import type { AutomationActionAvailabilityEntry } from '../api/automation.types';

interface AutomationRuleAvailabilityNoticeProps {
  actionAvailability: AutomationActionAvailabilityEntry[];
}

function reasonList(entries: AutomationActionAvailabilityEntry[]): ReactElement {
  return (
    <ul className="automation-rule-notice__reasons">
      {entries.map((entry) => (
        <li key={entry.action}>
          <span className="mono-text">{entry.action}</span>
          {/* Verbatim, never paraphrased — see `action-availability.ts`. */}
          {entry.reason === null ? null : <span> — {entry.reason}</span>}
        </li>
      ))}
    </ul>
  );
}

export function AutomationRuleAvailabilityNotice({
  actionAvailability,
}: AutomationRuleAvailabilityNoticeProps): ReactElement | null {
  const verdict = readRuleAvailability(actionAvailability);
  if (verdict.blocked.length === 0 && verdict.partial.length === 0) return null;

  return (
    <>
      {verdict.blocked.length > 0 ? (
        <Alert tone="error" title={AUTOMATION_AVAILABILITY_COPY.ruleBlockedTitle}>
          <p>
            {verdict.blocked.length === 1
              ? AUTOMATION_AVAILABILITY_COPY.ruleBlockedOne(verdict.blocked[0].action)
              : AUTOMATION_AVAILABILITY_COPY.ruleBlockedMany(
                  verdict.blocked.map((entry) => entry.action).join(', '),
                )}
          </p>
          {reasonList(verdict.blocked)}
        </Alert>
      ) : null}
      {verdict.partial.length > 0 ? (
        <Alert tone="warning" title={AUTOMATION_AVAILABILITY_COPY.rulePartialTitle}>
          {reasonList(verdict.partial)}
        </Alert>
      ) : null}
    </>
  );
}
