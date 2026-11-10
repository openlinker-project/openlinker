/**
 * SaveButton
 *
 * A primary button with three micro-states that cross-fade in place: idle,
 * saving (spinner) and saved (check draws in). The caller drives `state`; the
 * button is disabled while saving and `aria-live` announces the transition.
 *
 * @module apps/web/src/shared/ui
 */
import type { ReactElement } from 'react';

export type SaveButtonState = 'idle' | 'saving' | 'saved';

export interface SaveButtonProps {
  state: SaveButtonState;
  idleLabel: string;
  savingLabel: string;
  savedLabel: string;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  'data-testid'?: string;
}

export function SaveButton({
  state,
  idleLabel,
  savingLabel,
  savedLabel,
  disabled,
  title,
  onClick,
  'data-testid': testId,
}: SaveButtonProps): ReactElement {
  const cls = [
    'button',
    'button--sm',
    'pm-save',
    state === 'saving' ? 'is-saving' : '',
    state === 'saved' ? 'is-saved' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type="button"
      className={cls}
      disabled={disabled || state === 'saving'}
      title={title}
      onClick={onClick}
      aria-live="polite"
      data-testid={testId}
    >
      <span className="pm-save__a">{idleLabel}</span>
      <span className="pm-save__b" aria-hidden={state !== 'saving'}>
        <i className="pm-save__spin" />
        {savingLabel}
      </span>
      <span className="pm-save__c" aria-hidden={state !== 'saved'}>
        <svg viewBox="0 0 14 14" aria-hidden="true">
          <path d="M2.5 7.5 5.5 10.5 11.5 3.5" />
        </svg>
        {savedLabel}
      </span>
    </button>
  );
}
