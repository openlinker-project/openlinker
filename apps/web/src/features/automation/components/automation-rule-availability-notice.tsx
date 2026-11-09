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
import { interpolate, useFormat, useMessages } from '../../../shared/i18n';
import { readRuleAvailability } from '../lib/action-availability';
import type { AutomationActionAvailabilityEntry } from '../api/automation.types';

interface AutomationRuleAvailabilityNoticeProps {
  actionAvailability: AutomationActionAvailabilityEntry[];
}

function reasonList(
  entries: AutomationActionAvailabilityEntry[],
  reasonSuffix: string,
): ReactElement {
  return (
    <ul className="automation-rule-notice__reasons">
      {entries.map((entry) => (
        <li key={entry.action}>
          <span className="mono-text">{entry.action}</span>
          {/* Verbatim, never paraphrased — see `action-availability.ts`. */}
          {entry.reason === null ? null : (
            <span>
              {' '}
              {interpolate(reasonSuffix, { reason: entry.reason })}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function AutomationRuleAvailabilityNotice({
  actionAvailability,
}: AutomationRuleAvailabilityNoticeProps): ReactElement | null {
  const copy = useMessages('automation').availability;
  const format = useFormat();
  const verdict = readRuleAvailability(actionAvailability);
  if (verdict.blocked.length === 0 && verdict.partial.length === 0) return null;

  return (
    <>
      {verdict.blocked.length > 0 ? (
        <Alert tone="error" title={copy.ruleBlockedTitle}>
          <p>
            {verdict.blocked.length === 1
              ? interpolate(copy.ruleBlockedOne, { action: verdict.blocked[0].action })
              : interpolate(copy.ruleBlockedMany, {
                  actions: format.list(
                    verdict.blocked.map((entry) => entry.action),
                    'unit',
                  ),
                })}
          </p>
          {reasonList(verdict.blocked, copy.reasonSuffix)}
        </Alert>
      ) : null}
      {verdict.partial.length > 0 ? (
        <Alert tone="warning" title={copy.rulePartialTitle}>
          {reasonList(verdict.partial, copy.reasonSuffix)}
        </Alert>
      ) : null}
    </>
  );
}
