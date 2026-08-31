/**
 * DocumentLifecycle (#2536)
 *
 * A compact horizontal trail of an invoice's persisted stages: the document
 * itself, and separately the answer from the tax authority. One step per state
 * the system stores, with the timestamp it stores for it, and nothing else.
 *
 * Three rules define it, and each closes a specific way this display goes wrong.
 *
 *  1. **A step exists only if the system stores it.** An earlier progress
 *     display invented three device phases nothing observes, which turned a
 *     waiting screen into a claim about hardware. The caller passes the steps it
 *     read off persisted fields; this component adds none and infers none.
 *  2. **A missing timestamp is stated as missing.** A step can legitimately be
 *     reached with no time recorded for it, so the slot renders an explicit
 *     absent marker rather than borrowing the neighbouring step's time or
 *     quietly showing nothing.
 *  3. **A fiscal receipt gets no trail at all.** It has no authority axis
 *     (ADR-042, ADR-065), so there is no second stage to walk. The component
 *     refuses to render one rather than trusting every caller to remember,
 *     which is what makes "no surface can show a receipt an authority answer"
 *     true rather than aspirational.
 *
 * State is never carried by colour alone: each step's marker has its own shape,
 * and each step announces its state in words to assistive technology.
 *
 * @module shared/ui
 */
import type { ReactElement } from 'react';
import { AbsentValue } from './absent-value';
import { TimeDisplay } from './time-display';
import type { DocumentKind } from './document-kind-glyph';

/**
 * Where one step stands.
 *
 * `todo` is a stage that has not been reached; `active` is the one in flight;
 * `error` is a stage that resolved against the document. There is no `skipped`:
 * a stage the document did not go through is not passed at all.
 */
export type DocumentLifecycleStepState = 'todo' | 'active' | 'done' | 'error';

export interface DocumentLifecycleStep {
  /** Stable key. Not the label, which is display copy and may change. */
  id: string;
  label: string;
  state: DocumentLifecycleStepState;
  /** ISO timestamp, or null when the system records none for this step. */
  at?: string | null;
}

export interface DocumentLifecycleProps {
  /** Anything other than `invoice` renders nothing. See rule 3 above. */
  kind: DocumentKind | null;
  steps: readonly DocumentLifecycleStep[];
  /** Names the trail for assistive technology. */
  label?: string;
  className?: string;
}

/** Announced beside each step, so its state never rests on colour. */
const STATE_WORD: Record<DocumentLifecycleStepState, string> = {
  todo: 'not yet reached',
  active: 'in progress',
  done: 'done',
  error: 'failed',
};

export function DocumentLifecycle({
  kind,
  steps,
  label = 'Document lifecycle',
  className = '',
}: DocumentLifecycleProps): ReactElement | null {
  if (kind !== 'invoice' || steps.length === 0) return null;

  const classes = ['document-lifecycle', className].filter(Boolean).join(' ');

  return (
    <ol className={classes} aria-label={label}>
      {steps.map((step) => (
        <li
          key={step.id}
          className={`document-lifecycle__step document-lifecycle__step--${step.state}`}
          aria-current={step.state === 'active' ? 'step' : undefined}
        >
          <StepMarker state={step.state} />
          <span className="document-lifecycle__label">
            {step.label}
            <span className="sr-only">{`, ${STATE_WORD[step.state]}`}</span>
          </span>
          <span className="document-lifecycle__time">
            {step.at ? (
              <TimeDisplay iso={step.at} format="datetime" />
            ) : (
              <AbsentValue label={`No time recorded for ${step.label}`} />
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * The marker, whose SHAPE carries the state: a hollow ring not yet reached, a
 * ringed dot in flight, a tick done, a cross failed.
 */
function StepMarker({ state }: { state: DocumentLifecycleStepState }): ReactElement {
  return (
    <span className="document-lifecycle__marker" aria-hidden="true">
      {state === 'done' ? (
        <svg viewBox="0 0 10 10" width="10" height="10">
          <path
            d="M2 5.2 4 7.2 8 2.8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
      {state === 'error' ? (
        <svg viewBox="0 0 10 10" width="10" height="10">
          <path
            d="M3 3l4 4M7 3l-4 4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      ) : null}
    </span>
  );
}
