/**
 * SetupStepper
 *
 * Horizontal step indicator for multi-step setup wizards. On mobile (< 768 px)
 * it collapses to a "Step N of M" label with progress dots so the full step
 * list does not crowd narrow viewports.
 */
import type { ReactElement } from 'react';

export interface SetupStepperProps {
  steps: readonly string[];
  currentStep: number; // 0-based
  completedSteps?: ReadonlySet<number>;
  className?: string;
}

export function SetupStepper({
  steps,
  currentStep,
  completedSteps = new Set(),
  className,
}: SetupStepperProps): ReactElement {
  return (
    <nav
      aria-label="Setup progress"
      className={['setup-stepper', className].filter(Boolean).join(' ')}
    >
      {/* Desktop / tablet: full step list */}
      <ol className="setup-stepper__list" aria-hidden="false">
        {steps.map((label, index) => {
          const isDone = completedSteps.has(index);
          const isCurrent = index === currentStep;
          const modifier = isDone
            ? 'done'
            : isCurrent
              ? 'current'
              : index < currentStep
                ? 'done'
                : 'upcoming';

          return (
            <li
              key={label}
              className={`setup-stepper__step setup-stepper__step--${modifier}`}
              aria-current={isCurrent ? 'step' : undefined}
            >
              <span className="setup-stepper__indicator" aria-hidden="true">
                {modifier === 'done' ? (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                    <path
                      d="M2 6l3 3 5-5"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  <span>{index + 1}</span>
                )}
              </span>
              <span className="setup-stepper__label">{label}</span>
              {index < steps.length - 1 && (
                <span className="setup-stepper__connector" aria-hidden="true" />
              )}
            </li>
          );
        })}
      </ol>

      {/* Mobile: compact "Step N of M" with dots */}
      <div className="setup-stepper__mobile" aria-hidden="true">
        <span className="setup-stepper__mobile-label">
          Step {currentStep + 1} of {steps.length}
        </span>
        <span className="setup-stepper__mobile-title">{steps[currentStep]}</span>
        <ol className="setup-stepper__dots">
          {steps.map((label, index) => (
            <li
              key={label}
              className={[
                'setup-stepper__dot',
                index < currentStep ? 'setup-stepper__dot--done' : '',
                index === currentStep ? 'setup-stepper__dot--current' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            />
          ))}
        </ol>
      </div>
    </nav>
  );
}
