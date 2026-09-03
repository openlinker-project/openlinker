/**
 * The first-run suggestion (#2364, spec §5.1)
 *
 * Eight triggers reading "No rules" is technically complete and useless as a
 * starting point, so a fresh install leads with exactly ONE suggestion.
 *
 * Three properties are load-bearing and each is the opposite of an easy
 * mistake. It is a SUGGESTION, never a rule that exists before the operator
 * saved it — opening this page creates nothing, and `Set this up` only opens
 * the composer pre-filled, still subject to the arming gate. Exactly one is
 * offered, deliberately; a menu of starting points is a second index. And it
 * disappears permanently once any rule exists, active or not, and never returns
 * after the operator deletes their last rule — a card that came back would read
 * as OpenLinker forgetting what they had already decided.
 *
 * The caveat line is not hedging: the suggested rule buys a shipping label, and
 * that is one of the steps this build cannot run. Recommending it without
 * saying so would be the silent-decline defect in the one place the product
 * actively tells an operator what to do.
 *
 * @module apps/web/src/features/automation/components
 */
import type { ReactElement } from 'react';
import { Button } from '../../../shared/ui/button';
import { AUTOMATION_SUGGESTION_COPY } from '../lib/automation.copy';

interface AutomationSuggestionCardProps {
  /** Opens the composer pre-filled with the suggested rule. Creates nothing. */
  onSetUp: () => void;
  /** Opens the composer empty. */
  onStartFromScratch: () => void;
}

export function AutomationSuggestionCard({
  onSetUp,
  onStartFromScratch,
}: AutomationSuggestionCardProps): ReactElement {
  return (
    <article className="panel automation-suggestion">
      <div className="panel__header">
        <div>
          <h3 className="section-title">{AUTOMATION_SUGGESTION_COPY.title}</h3>
          <p className="muted-text">{AUTOMATION_SUGGESTION_COPY.intro}</p>
        </div>
      </div>
      <p className="automation-suggestion__rule">{AUTOMATION_SUGGESTION_COPY.suggestion}</p>
      <p className="muted-text">{AUTOMATION_SUGGESTION_COPY.rationale}</p>
      <p className="muted-text automation-suggestion__caveat">
        {AUTOMATION_SUGGESTION_COPY.caveat}
      </p>
      <div className="automation-suggestion__actions">
        <Button tone="primary" onClick={onSetUp}>
          {AUTOMATION_SUGGESTION_COPY.primary}
        </Button>
        <Button tone="secondary" onClick={onStartFromScratch}>
          {AUTOMATION_SUGGESTION_COPY.secondary}
        </Button>
      </div>
    </article>
  );
}
