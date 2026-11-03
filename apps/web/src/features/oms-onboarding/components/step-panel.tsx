/**
 * Step panel (#3457)
 *
 * The chrome every wizard step shares: "Step N of 4", the step title (which
 * takes focus when the step changes, so a keyboard or screen-reader user lands
 * on the new step rather than on a button that no longer exists), the one
 * sentence of why, the body, and a footer with Back on the left and the step's
 * own primary action on the right.
 *
 * @module features/oms-onboarding/components
 */
import { useEffect, useRef, type ReactElement, type ReactNode } from 'react';

import { Button } from '../../../shared/ui/button';
import { omsOnboardingCopy as COPY } from '../lib/oms-onboarding.copy';
import { TOTAL_STEPS } from '../lib/onboarding-state';

export interface StepPanelProps {
  readonly step: number;
  readonly why: string;
  readonly children: ReactNode;
  readonly next: ReactNode;
  readonly onBack?: () => void;
}

export function StepPanel({ step, why, children, next, onBack }: StepPanelProps): ReactElement {
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, [step]);

  return (
    <section
      className="panel oms-onboarding__panel"
      aria-labelledby="oms-onboarding-step-title"
      data-testid="wizard-step-panel"
      data-step={step}
    >
      <header className="oms-onboarding__panel-head">
        <p className="oms-onboarding__eyebrow">{COPY.stepOf(step, TOTAL_STEPS)}</p>
        <h2 className="oms-onboarding__panel-title" id="oms-onboarding-step-title" tabIndex={-1} ref={titleRef}>
          {COPY.steps[step - 1].title}
        </h2>
        <p className="oms-onboarding__why">{why}</p>
      </header>
      <div className="oms-onboarding__panel-body">{children}</div>
      <footer className="oms-onboarding__panel-foot" data-testid="wizard-step-footer">
        <span>
          {onBack !== undefined && step > 1 ? (
            <Button type="button" tone="ghost" data-testid="btn-back" onClick={onBack}>
              ← {COPY.back}
            </Button>
          ) : null}
        </span>
        <span className="oms-onboarding__panel-next">{next}</span>
      </footer>
    </section>
  );
}
