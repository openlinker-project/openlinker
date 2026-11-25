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
import { useMessages } from '../i18n/use-messages';
import { interpolate } from '../i18n/interpolate';

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
  /** Also render `stepMeta` under the labels of the horizontal layout. */
  metaInline?: boolean;
  /**
   * Explains a step the operator cannot open yet. With it, a locked step stays
   * focusable (`aria-disabled`) so the reason is reachable, and the mobile dots
   * become buttons too.
   */
  lockedHint?: string;
  /** Steps the operator passed but left incomplete; marked for attention. */
  attentionSteps?: ReadonlySet<number>;
  /** Accessible suffix for an attention step, e.g. "needs attention". */
  attentionLabel?: string;
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
  metaInline = false,
  lockedHint,
  attentionSteps,
  attentionLabel,
}: SetupStepperProps): ReactElement {
  const reached = maxReachedStep ?? currentStep;
  const copy = useMessages('ui').setupStepper;

  return (
    <nav
      aria-label={copy.label}
      className={['setup-stepper', orientation === 'vertical' ? 'setup-stepper--vertical' : '', className]
        .filter(Boolean)
        .join(' ')}
      data-testid={testId}
    >
      {/* Desktop / tablet: full step list */}
      <ol className="setup-stepper__list">
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

          const locked = onSelectStep !== undefined && index > reached;
          const needsAttention = attentionSteps?.has(index) === true && !isCurrent;
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
                <span className="setup-stepper__label">
                  {label}
                  {needsAttention && attentionLabel !== undefined ? (
                    <span className="sr-only"> ({attentionLabel})</span>
                  ) : null}
                </span>
                {(orientation === 'vertical' || metaInline) && stepMeta !== undefined ? (
                  // Always rendered, even empty, so every row is the same height.
                  <span className="setup-stepper__meta">{stepMeta[index]}</span>
                ) : null}
              </span>
            </>
          );

          return (
            <li
              key={label}
              className={`setup-stepper__step setup-stepper__step--${modifier}${needsAttention ? ' setup-stepper__step--attention' : ''}`}
              aria-current={isCurrent && onSelectStep === undefined ? 'step' : undefined}
              data-testid={testIdFor(testId, `step-${index + 1}`)}
            >
              {onSelectStep === undefined ? (
                content
              ) : (
                <button
                  type="button"
                  className="setup-stepper__button"
                  disabled={locked && lockedHint === undefined}
                  aria-disabled={locked && lockedHint !== undefined ? true : undefined}
                  title={locked && lockedHint !== undefined ? lockedHint : undefined}
                  aria-current={isCurrent ? 'step' : undefined}
                  data-testid={testIdFor(testId, `button-${index + 1}`)}
                  onClick={() => {
                    if (locked) return;
                    onSelectStep(index);
                  }}
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
      <div
        className="setup-stepper__mobile"
        aria-hidden={lockedHint === undefined ? true : undefined}
      >
        <span className="setup-stepper__mobile-label">
          {interpolate(copy.step, { current: currentStep + 1, total: steps.length })}
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
            >
              {onSelectStep !== undefined && lockedHint !== undefined ? (
                <button
                  type="button"
                  className="setup-stepper__dot-button"
                  aria-label={`${interpolate(copy.step, { current: index + 1, total: steps.length })}: ${label}`}
                  aria-current={index === currentStep ? 'step' : undefined}
                  aria-disabled={index > reached ? true : undefined}
                  title={index > reached ? lockedHint : undefined}
                  onClick={() => {
                    if (index <= reached) onSelectStep(index);
                  }}
                />
              ) : null}
            </li>
          ))}
        </ol>
        {lockedHint !== undefined ? (
          <span className="setup-stepper__progress" aria-hidden="true">
            <span style={{ width: `${((currentStep + 1) / steps.length) * 100}%` }} />
          </span>
        ) : null}
      </div>
    </nav>
  );
}
