/**
 * SaveButton (#3935)
 *
 * A save action with its own three-state micro-animation: the label rolls up
 * into a spinner while saving, then into a check mark that draws itself. The
 * width is fixed so the button never jumps. The state is the caller's: pass it
 * straight when it already has one, or derive it from a mutation with
 * `useSaveButtonState`, which is honest (the check appears only after the server
 * said yes, and an error sends the button straight back to its label).
 *
 * @module shared/ui
 */
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactElement } from 'react';

export type SaveButtonState = 'idle' | 'saving' | 'saved';

export interface SaveButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  state: SaveButtonState;
  labels: { idle: string; saving: string; saved: string };
}

const SAVED_MS = 1800;

/**
 * The button state of a request: `saving` while it runs, `saved` for a moment
 * each time `savedCount` goes up, `idle` otherwise.
 */
export function useSaveButtonState(pending: boolean, savedCount: number): SaveButtonState {
  const [saved, setSaved] = useState(false);
  const seen = useRef(savedCount);

  useEffect(() => {
    if (savedCount === seen.current) return undefined;
    seen.current = savedCount;
    setSaved(true);
    const timer = window.setTimeout(() => {
      setSaved(false);
    }, SAVED_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [savedCount]);

  return pending ? 'saving' : saved ? 'saved' : 'idle';
}

export function SaveButton({
  state,
  labels,
  className,
  disabled,
  type = 'button',
  ...props
}: SaveButtonProps): ReactElement {
  const classes = [
    'button',
    'button--primary',
    'button--sm',
    'pm-save',
    state === 'saving' ? 'is-saving' : '',
    state === 'saved' ? 'is-saved' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type={type}
      className={classes}
      aria-label={labels.idle}
      disabled={disabled || state === 'saving'}
      aria-busy={state === 'saving' || undefined}
      {...props}
    >
      <span className="pm-save__a">{labels.idle}</span>
      <span className="pm-save__b" aria-hidden="true">
        <i className="pm-save__spin" />
        {labels.saving}
      </span>
      <span className="pm-save__c" aria-hidden="true">
        <svg viewBox="0 0 16 16">
          <path d="M3 8.5l3.2 3.2L13 4.8" />
        </svg>
        {labels.saved}
      </span>
      <span className="sr-only" role="status">
        {state === 'saving' ? labels.saving : state === 'saved' ? labels.saved : ''}
      </span>
    </button>
  );
}
