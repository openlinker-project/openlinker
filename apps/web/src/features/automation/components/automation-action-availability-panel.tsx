/**
 * What automations can do in this build (#2364)
 *
 * Renders all six actions with their declared availability, sourced entirely
 * from `GET /automations/vocabulary`.
 *
 * **All six, always — never a filtered list.** Hiding the four that cannot run
 * would leave an operator unable to understand why nothing fires, and unable to
 * tell "OpenLinker has no such feature" from "it is not finished". Showing them
 * as ready would be worse: they would arm a rule and learn the truth from a
 * failed run. So every action is listed, each with its own badge and, where the
 * backend supplied one, its reason verbatim.
 *
 * @module apps/web/src/features/automation/components
 */
import type { ReactElement } from 'react';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { AUTOMATION_AVAILABILITY_COPY } from '../lib/automation.copy';
import { describeAvailability } from '../lib/action-availability';
import type { AutomationActionVocabulary } from '../api/automation.types';

interface AutomationActionAvailabilityPanelProps {
  actions: AutomationActionVocabulary[];
}

export function AutomationActionAvailabilityPanel({
  actions,
}: AutomationActionAvailabilityPanelProps): ReactElement {
  return (
    <article className="panel panel--dense automation-availability">
      <div className="panel__header">
        <div>
          <p className="eyebrow">{AUTOMATION_AVAILABILITY_COPY.panelTitle}</p>
          <p className="muted-text">{AUTOMATION_AVAILABILITY_COPY.panelIntro}</p>
        </div>
      </div>
      <ul className="automation-availability__list">
        {actions.map((action) => {
          const described = describeAvailability(action.availability);
          return (
            <li key={action.action} className="automation-availability__item">
              <div className="automation-availability__head">
                <span className="mono-text">{action.action}</span>
                <StatusBadge tone={described.tone} withDot compact>
                  {described.label}
                </StatusBadge>
                {action.irreversible ? (
                  <StatusBadge tone="warning" compact>
                    {AUTOMATION_AVAILABILITY_COPY.irreversible}
                  </StatusBadge>
                ) : null}
              </div>
              {/*
                The backend's own sentence, verbatim. See `action-availability.ts`
                for why it is never paraphrased.
              */}
              {action.reason === null ? null : (
                <p className="muted-text automation-availability__reason">{action.reason}</p>
              )}
            </li>
          );
        })}
      </ul>
    </article>
  );
}
