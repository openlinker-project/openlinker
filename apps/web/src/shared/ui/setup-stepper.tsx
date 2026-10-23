/**
 * SetupStepper
 *
 * Horizontal step indicator for multi-step setup wizards. On mobile (< 768 px)
 * it collapses to a "Step N of M" label with progress dots so the full step
 * list does not crowd narrow viewports.
 *
 * ## Navigation is opt-in (#3457)
 *
 * Passing `onSelectStep` turns each step into a `<button>` an operator can go
 * back to; steps past `maxReachedStep` render disabled, because a wizard must
 * not let an operator skip a step it has not shown them. Without
 * `onSelectStep` the markup is exactly what it was, so the display-only
 * consumers are unaffected. `testId` names the stepper and its parts
 * (`{testId}-step-{n}`, `{testId}-button-{n}`, 1-based) for E2E specs that
 * address a step by number.
 */
import type { ReactElement, ReactNode } from 'react';

export interface SetupStepperProps {
  steps: readonly string[];
  currentStep: number; // 0-based
  completedSteps?: ReadonlySet<number>;
  className?: string;
  /** Makes the steps clickable. Receives the 0-based index. */
  onSelectStep?: (index: number) => void;
  /** 0-based. With `onSelectStep`, steps after this one are disabled. Defaults to `currentStep`. */
  maxReachedStep?: number;
  testId?: string;
  /**
   * `vertical` stacks the steps in a column for a wizard that keeps its list
   * beside the content. Horizontal stays the default, so every other wizard
   * is unchanged.
   */
  orientation?: 'horizontal' | 'vertical';
  /** A short line under each step's label, shown in the vertical layout. Same order as `steps`. */
  stepMeta?: readonly string[];
}

function testIdFor(testId: string | undefined, part: string): string | undefined {
  return testId === undefined ? undefined : `${testId}-${part}`;
}

export function SetupStepper({
  steps,
  currentStep,
  completedSteps = new Set(),
  className,
  onSelectStep,
  maxReachedStep,
  testId,
  orientation = 'horizontal',
  stepMeta,
}: SetupStepperProps): ReactElement {
  const reached = maxReachedStep ?? currentStep;

  return (
    <nav
      aria-label="Setup progress"
      className={['setup-stepper', orientation === 'vertical' ? 'setup-stepper--vertical' : '', className]
        .filter(Boolean)
        .join(' ')}
      data-testid={testId}
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

          const content: ReactNode = (
            <>
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
              <span className="setup-stepper__text">
                <span className="setup-stepper__label">{label}</span>
                {orientation === 'vertical' && stepMeta !== undefined ? (
                  // Always rendered, even empty, so every row is the same height.
                  <span className="setup-stepper__meta">{stepMeta[index]}</span>
                ) : null}
              </span>
            </>
          );

          return (
            <li
              key={label}
              className={`setup-stepper__step setup-stepper__step--${modifier}`}
              aria-current={isCurrent && onSelectStep === undefined ? 'step' : undefined}
              data-testid={testIdFor(testId, `step-${index + 1}`)}
            >
              {onSelectStep === undefined ? (
                content
              ) : (
                <button
                  type="button"
                  className="setup-stepper__button"
                  disabled={index > reached}
                  aria-current={isCurrent ? 'step' : undefined}
                  data-testid={testIdFor(testId, `button-${index + 1}`)}
                  onClick={() => onSelectStep(index)}
                >
                  {content}
                </button>
              )}
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
