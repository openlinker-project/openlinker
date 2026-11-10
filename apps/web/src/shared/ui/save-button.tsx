/**
 * SaveButton
 *
 * A save action with its own three-state micro-animation: the label rolls up
 * into a spinner while saving, then into a checkmark that draws itself. The
 * width is fixed so the button never jumps, and the state is announced through
 * the caller's own live region (the visible words change, the button does not
 * announce them again).
 *
 * @module shared/ui
 */
import type { ButtonHTMLAttributes, ReactElement } from 'react';

export type SaveButtonState = 'idle' | 'saving' | 'saved';

export interface SaveButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'type'> {
  state: SaveButtonState;
  labels: { idle: string; saving: string; saved: string };
}

export function SaveButton({
  state,
  labels,
  className = '',
  disabled,
  ...props
}: SaveButtonProps): ReactElement {
  const classes = [
    'button',
    'button--primary',
    'button--sm',
    'save-button',
    state === 'saving' ? 'is-saving' : '',
    state === 'saved' ? 'is-saved' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type="button"
      className={classes}
      disabled={disabled || state !== 'idle'}
      aria-busy={state === 'saving' || undefined}
      {...props}
    >
      <span className="save-button__a">{labels.idle}</span>
      <span className="save-button__b" aria-hidden="true">
        <i className="save-button__spin" />
        {labels.saving}
      </span>
      <span className="save-button__c" aria-hidden="true">
        <svg viewBox="0 0 14 14">
          <path d="M2.5 7.5 5.5 10.5 11.5 3.5" />
        </svg>
        {labels.saved}
      </span>
    </button>
  );
}
